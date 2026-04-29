const Notification = require("../models/Notification");
const ClientAuth   = require("../models/ClientAuth");
const {
  sendContentApprovalEmail,
  sendInvoiceEmail,
  sendPaymentReminderEmail,
  sendShootReminderEmail,
} = require("./mailer");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ── Create notification in DB ─────────────────────────────────────
async function createNotification(data) {
  try {
    return await Notification.create(data);
  } catch (err) {
    console.error("Notification create error:", err.message);
  }
}

// ── Notify admin ──────────────────────────────────────────────────
async function notifyAdmin({ title, message, type, link, clientId, contentId, invoiceId }) {
  // Get all admin user IDs
  const User = require("../models/User");
  const admins = await User.find({ role: { $in: ["admin","manager"] }, status: "active" }).select("_id");
  for (const admin of admins) {
    await createNotification({
      recipientType: "admin",
      recipientId:   admin._id,
      title, message, type,
      link:      link || "",
      clientId:  clientId  || null,
      contentId: contentId || null,
      invoiceId: invoiceId || null,
    });
  }
}

// ── Notify client (in-app + optional email) ───────────────────────
async function notifyClient({ clientId, title, message, type, link, contentId, invoiceId, emailData }) {
  // In-app notification
  await createNotification({
    recipientType: "client",
    recipientId:   clientId,
    title, message, type,
    link:      link      || "",
    clientId:  clientId  || null,
    contentId: contentId || null,
    invoiceId: invoiceId || null,
  });

  // Email notification
  if (emailData) {
    try {
      const auth = await ClientAuth.findOne({ clientId });
      if (auth?.email) {
        emailData.email = auth.email;
        if (type === "content_approved" || type === "content_rejected" || type === "content_changes_requested") {
          await sendContentApprovalEmail(emailData);
        } else if (type === "invoice_generated") {
          await sendInvoiceEmail(emailData);
        } else if (type === "payment_reminder") {
          await sendPaymentReminderEmail(emailData);
        } else if (type === "shoot_reminder") {
          await sendShootReminderEmail(emailData);
        }
        await Notification.findOneAndUpdate(
          { recipientId: clientId, type, createdAt: { $gte: new Date(Date.now() - 5000) } },
          { emailSent: true }
        );
      }
    } catch (err) {
      console.error("Email notification error:", err.message);
    }
  }
}

module.exports = { notifyAdmin, notifyClient, createNotification };
