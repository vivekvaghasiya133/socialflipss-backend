const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const BRAND = {
  name:  "SocialFlipss",
  color: "#1a56db",
  light: "#e8f0fe",
};

function baseTemplate(content) {
  return `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:540px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:${BRAND.color};padding:20px 28px;display:flex;align-items:center;gap:12px;">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.2);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;">SF</div>
        <span style="color:#fff;font-size:18px;font-weight:700;">${BRAND.name}</span>
      </div>
      <div style="padding:28px;">${content}</div>
      <div style="padding:16px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;">
        SocialFlipss Digital Marketing · Surat, Gujarat · This is an automated email.
      </div>
    </div>`;
}

// ── OTP Email ──────────────────────────────────────────────────────
async function sendOTPEmail({ email, name, otp }) {
  await transporter.sendMail({
    from:    `"${BRAND.name}" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `${otp} — Your SocialFlipss Login OTP`,
    html:    baseTemplate(`
      <p style="font-size:15px;color:#111;">Hi <strong>${name}</strong>,</p>
      <p style="color:#374151;margin:12px 0;">Your one-time password for SocialFlipss Client Portal:</p>
      <div style="text-align:center;margin:24px 0;">
        <div style="display:inline-block;background:#f0f4ff;border:2px dashed ${BRAND.color};border-radius:12px;padding:16px 40px;">
          <span style="font-size:36px;font-weight:800;color:${BRAND.color};letter-spacing:8px;">${otp}</span>
        </div>
        <p style="color:#6b7280;font-size:12px;margin-top:10px;">Valid for 10 minutes only</p>
      </div>
      <p style="color:#6b7280;font-size:13px;">If you did not request this, please ignore this email.</p>`),
  });
}

// ── Content Approval Status ────────────────────────────────────────
async function sendContentApprovalEmail({ email, clientName, contentTitle, status, comment, portalLink }) {
  const approved = status === "approved";
  const emoji    = approved ? "✅" : status === "rejected" ? "❌" : "🔄";
  const label    = approved ? "Approved" : status === "rejected" ? "Rejected" : "Changes Requested";
  const color    = approved ? "#0e9f6e" : status === "rejected" ? "#e02424" : "#d97706";

  await transporter.sendMail({
    from:    `"${BRAND.name}" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `${emoji} Content ${label} — ${contentTitle}`,
    html:    baseTemplate(`
      <p style="font-size:15px;color:#111;">Hi <strong>${clientName}</strong>,</p>
      <p style="color:#374151;margin:12px 0;">Your content review has been updated:</p>
      <div style="background:${color}18;border-left:4px solid ${color};border-radius:0 8px 8px 0;padding:14px 18px;margin:20px 0;">
        <p style="margin:0;font-weight:700;color:${color};font-size:16px;">${emoji} ${label}</p>
        <p style="margin:6px 0 0;color:#374151;font-size:14px;"><strong>Content:</strong> ${contentTitle}</p>
        ${comment ? `<p style="margin:6px 0 0;color:#374151;font-size:14px;"><strong>Note:</strong> ${comment}</p>` : ""}
      </div>
      <a href="${portalLink}" style="display:inline-block;background:${BRAND.color};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;margin-top:8px;">View in Portal →</a>`),
  });
}

// ── Invoice Generated ──────────────────────────────────────────────
async function sendInvoiceEmail({ email, clientName, invoiceNumber, amount, dueDate, month, portalLink }) {
  await transporter.sendMail({
    from:    `"${BRAND.name}" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `🧾 Invoice ${invoiceNumber} — ₹${Number(amount).toLocaleString("en-IN")}`,
    html:    baseTemplate(`
      <p style="font-size:15px;color:#111;">Hi <strong>${clientName}</strong>,</p>
      <p style="color:#374151;margin:12px 0;">Your invoice for <strong>${month}</strong> is ready:</p>
      <div style="background:#f9fafb;border-radius:10px;padding:20px;margin:20px 0;">
        <table style="width:100%;font-size:14px;">
          <tr><td style="color:#6b7280;padding:6px 0;">Invoice No.</td><td style="font-weight:600;text-align:right;">${invoiceNumber}</td></tr>
          <tr><td style="color:#6b7280;padding:6px 0;">Period</td><td style="text-align:right;">${month}</td></tr>
          <tr><td style="color:#6b7280;padding:6px 0;">Amount</td><td style="font-weight:700;color:${BRAND.color};text-align:right;font-size:18px;">₹${Number(amount).toLocaleString("en-IN")}</td></tr>
          <tr><td style="color:#6b7280;padding:6px 0;">Due Date</td><td style="text-align:right;">${dueDate}</td></tr>
        </table>
      </div>
      <a href="${portalLink}" style="display:inline-block;background:${BRAND.color};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Invoice →</a>
      <p style="color:#6b7280;font-size:13px;margin-top:16px;">Please process payment by the due date. Thank you! 🙏</p>`),
  });
}

// ── Payment Reminder ───────────────────────────────────────────────
async function sendPaymentReminderEmail({ email, clientName, invoiceNumber, pendingAmount, daysPassed, portalLink }) {
  await transporter.sendMail({
    from:    `"${BRAND.name}" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `⚠️ Payment Reminder — ₹${Number(pendingAmount).toLocaleString("en-IN")} Pending`,
    html:    baseTemplate(`
      <p style="font-size:15px;color:#111;">Hi <strong>${clientName}</strong>,</p>
      <p style="color:#374151;margin:12px 0;">This is a friendly reminder for your pending payment:</p>
      <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:18px;margin:20px 0;">
        <p style="margin:0;font-weight:700;color:#c2410c;font-size:16px;">⚠️ Payment Pending</p>
        <p style="margin:8px 0 0;color:#374151;">Invoice: <strong>${invoiceNumber}</strong></p>
        <p style="margin:4px 0 0;color:#374151;">Amount Due: <strong style="font-size:20px;color:#c2410c;">₹${Number(pendingAmount).toLocaleString("en-IN")}</strong></p>
        <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${daysPassed} days since invoice generated</p>
      </div>
      <a href="${portalLink}" style="display:inline-block;background:#0e9f6e;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Pay Now →</a>
      <p style="color:#6b7280;font-size:13px;margin-top:16px;">Koi sawaal hoy to reply karo. Thank you! 🙏</p>`),
  });
}

// ── Shoot Reminder ─────────────────────────────────────────────────
async function sendShootReminderEmail({ email, clientName, date, timeSlot, reelCount, projectName }) {
  await transporter.sendMail({
    from:    `"${BRAND.name}" <${process.env.GMAIL_USER}>`,
    to:      email,
    subject: `📷 Shoot Reminder — ${date}`,
    html:    baseTemplate(`
      <p style="font-size:15px;color:#111;">Hi <strong>${clientName}</strong>,</p>
      <p style="color:#374151;margin:12px 0;">Kal tamaro shoot scheduled chhe:</p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:20px;margin:20px 0;">
        <p style="margin:0;font-size:20px;">📅 <strong>${date}</strong></p>
        <p style="margin:8px 0 0;">⏰ Time: <strong>${timeSlot}</strong></p>
        <p style="margin:4px 0 0;">🎬 Reels: <strong>${reelCount}</strong></p>
        <p style="margin:4px 0 0;">📁 Project: ${projectName}</p>
      </div>
      <p style="color:#374151;font-size:14px;">Please available rahejo. Koi change hoy to reply karo.</p>`),
  });
}

module.exports = {
  sendOTPEmail,
  sendContentApprovalEmail,
  sendInvoiceEmail,
  sendPaymentReminderEmail,
  sendShootReminderEmail,
};
