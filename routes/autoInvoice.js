const express           = require("express");
const AutoInvoiceConfig = require("../models/AutoInvoiceConfig");
const Invoice           = require("../models/Invoice");
const Client            = require("../models/Client");
const { protect, authorize } = require("../middleware/auth");
const { notifyClient }  = require("../utils/notifier");

const router = express.Router();
router.use(protect);

// ── Invoice number generator ──────────────────────────────────────
async function generateInvoiceNumber() {
  const now    = new Date();
  const prefix = `SF-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const count  = await Invoice.countDocuments({ invoiceNumber: { $regex: `^${prefix}` } });
  return `${prefix}-${String(count+1).padStart(3,"0")}`;
}

// ── WhatsApp invoice message ──────────────────────────────────────
function buildInvoiceWhatsApp(client, invoice, month, portalLink) {
  const msg =
    `Hi ${client.ownerName} 👋\n\n` +
    `*SocialFlipss — Invoice Generated* 🧾\n\n` +
    `Tamaro *${month}* no invoice ready chhe:\n\n` +
    `📄 Invoice No: *${invoice.invoiceNumber}*\n` +
    `💰 Amount: *₹${Number(invoice.totalAmount).toLocaleString("en-IN")}*\n` +
    `📅 Due Date: *${new Date(invoice.dueDate).toLocaleDateString("en-IN")}*\n\n` +
    `Portal par invoice dekho:\n${portalLink}\n\n` +
    `If you have any questions, please reply. Thank you! 🙏\n` +
    `– SocialFlipss Team`;

  return client.mobile
    ? `https://wa.me/91${client.mobile.replace(/\D/g,"")}?text=${encodeURIComponent(msg)}`
    : null;
}

// ── Core: create invoice for a client ────────────────────────────
async function createInvoiceForClient(client, config, createdBy = null) {
  const now        = new Date();
  const month      = now.toLocaleString("en-IN", { month:"long", year:"numeric" });
  const dueDate    = new Date(now); dueDate.setDate(dueDate.getDate() + 15);
  const invoiceNum = await generateInvoiceNumber();

  const subtotal  = Number(config.packageAmount) +
    (config.extraItems||[]).reduce((s,i) => s + Number(i.amount||0), 0);
  const gstAmount = parseFloat((subtotal * (Number(config.gstPercent)||0) / 100).toFixed(2));
  const total     = parseFloat((subtotal + gstAmount).toFixed(2));

  const items = [
    { description: config.packageName || "Monthly Digital Marketing Service", quantity:1, rate:Number(config.packageAmount), amount:Number(config.packageAmount) },
    ...(config.extraItems||[]).map(e => ({ description:e.description, quantity:1, rate:Number(e.amount), amount:Number(e.amount) })),
  ];

  const invoice = await Invoice.create({
    invoiceNumber: invoiceNum,
    clientId:      client._id,
    month,
    issueDate:     now,
    dueDate,
    items,
    subtotal,
    gstPercent:    Number(config.gstPercent) || 0,
    gstAmount,
    totalAmount:   total,
    paidAmount:    0,
    pendingAmount: total,
    notes:         config.notes || "",
    createdBy:     createdBy || null,
  });

  const portalLink    = `${process.env.FRONTEND_URL || "http://localhost:3000"}/portal/invoices/${invoice._id}`;
  const whatsappLink  = buildInvoiceWhatsApp(client, invoice, month, portalLink);

  // In-app + email notification
  try {
    await notifyClient({
      clientId:  client._id,
      title:     `Invoice Generated — ${month}`,
      message:   `Your invoice for ${month} is ready: ₹${total.toLocaleString("en-IN")}`,
      type:      "invoice_generated",
      link:      `/portal/invoices/${invoice._id}`,
      invoiceId: invoice._id,
      emailData: { clientName:client.ownerName, invoiceNumber:invoiceNum, amount:total, month, dueDate:dueDate.toLocaleDateString("en-IN"), portalLink },
    });
  } catch (e) { console.error("Notify error:", e.message); }

  return { invoice, whatsappLink, portalLink, month };
}

// GET /api/auto-invoice/all
router.get("/all", authorize("admin","manager"), async (req, res) => {
  try {
    const configs = await AutoInvoiceConfig.find()
      .populate("clientId","businessName ownerName mobile _id")
      .sort({ createdAt:-1 });
    res.json(configs);
  } catch (err) { res.status(500).json({ message:"Server error" }); }
});

// POST /api/auto-invoice/setup
router.post("/setup", authorize("admin","manager"), async (req, res) => {
  try {
    const { clientId, packageAmount, packageName, gstPercent, extraItems, notes, reminders, enabled, dayOfMonth } = req.body;
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ message:"Client not found" });

    // Determine final dayOfMonth (use custom if valid, else default to onboarding date)
    let finalDay = Number(dayOfMonth);
    if (!finalDay || finalDay < 1 || finalDay > 31) {
      const onboardDate = new Date(client.onboardingDate || client.createdAt);
      finalDay = onboardDate.getDate();
    }

    const config = await AutoInvoiceConfig.findOneAndUpdate(
      { clientId },
      { clientId, dayOfMonth: finalDay, packageAmount:Number(packageAmount)||0, packageName:packageName||"Monthly Service",
        gstPercent:Number(gstPercent)||0, extraItems:extraItems||[], notes:notes||"",
        reminders:reminders||{ day5:true, day10:true, day15:true },
        enabled: enabled !== undefined ? enabled : true, createdBy:req.user._id },
      { upsert:true, new:true }
    );

    res.json({
      message:    "Auto invoice configured!",
      config,
      dayOfMonth: finalDay,
      note: `Invoice will auto-generate on day ${finalDay} of every month`,
    });
  } catch (err) { res.status(400).json({ message:err.message }); }
});

// GET /api/auto-invoice/:clientId
router.get("/:clientId", async (req, res) => {
  try {
    const config = await AutoInvoiceConfig.findOne({ clientId:req.params.clientId });
    res.json(config || null);
  } catch (err) { res.status(500).json({ message:"Server error" }); }
});

// POST /api/auto-invoice/generate/:clientId — manual generate
// ✅ FIX: returns whatsappLink so admin can click to send WA immediately
router.post("/generate/:clientId", authorize("admin","manager"), async (req, res) => {
  try {
    const config = await AutoInvoiceConfig.findOne({ clientId:req.params.clientId });
    if (!config) return res.status(404).json({ message:"Auto invoice not configured. Please set it up first." });

    const client = await Client.findById(req.params.clientId);
    if (!client) return res.status(404).json({ message:"Client not found" });

    const result = await createInvoiceForClient(client, config, req.user._id);

    const now   = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    await AutoInvoiceConfig.findByIdAndUpdate(config._id, {
      lastGeneratedMonth: month,
      lastGeneratedAt:    now,
      $inc: { totalGenerated:1 },
    });

    res.json({
      message:      "Invoice generated!",
      invoice:      result.invoice,
      whatsappLink: result.whatsappLink, // Click this to send WA to client
      portalLink:   result.portalLink,
      month:        result.month,
    });
  } catch (err) { res.status(400).json({ message:err.message }); }
});

// POST /api/auto-invoice/run-auto — cron daily trigger
router.post("/run-auto", authorize("admin"), async (req, res) => {
  try {
    const now   = new Date();
    const day   = now.getDate();
    const month = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;

    const configs = await AutoInvoiceConfig.find({
      enabled:    true,
      dayOfMonth: day,
      $or: [
        { lastGeneratedMonth: { $ne: month } },
        { lastGeneratedMonth: null },
        { lastGeneratedMonth: { $exists:false } },
      ],
    });

    const results = [];
    for (const config of configs) {
      try {
        const client = await Client.findById(config.clientId);
        if (!client || client.status !== "active") continue;

        const result = await createInvoiceForClient(client, config);
        await AutoInvoiceConfig.findByIdAndUpdate(config._id, {
          lastGeneratedMonth: month,
          lastGeneratedAt:    now,
          $inc: { totalGenerated:1 },
        });

        results.push({
          client:       client.businessName,
          invoice:      result.invoice.invoiceNumber,
          amount:       result.invoice.totalAmount,
          whatsappLink: result.whatsappLink,
        });
      } catch (err) {
        results.push({ error:err.message, clientId:config.clientId });
      }
    }

    res.json({
      message: `Auto-run complete. ${results.filter(r=>!r.error).length} invoices generated.`,
      results, // Each result has whatsappLink to send WA
    });
  } catch (err) { res.status(500).json({ message:err.message }); }
});

// POST /api/auto-invoice/send-reminders
router.post("/send-reminders", authorize("admin","manager"), async (req, res) => {
  try {
    const now             = new Date();
    const pendingInvoices = await Invoice.find({ paymentStatus:{ $in:["pending","partial"] } })
      .populate("clientId","businessName ownerName mobile _id");

    let sent = 0;
    const reminderLinks = [];

    for (const inv of pendingInvoices) {
      const config = await AutoInvoiceConfig.findOne({ clientId:inv.clientId._id });
      if (!config) continue;

      const daysPassed = Math.floor((now - new Date(inv.createdAt)) / (1000*60*60*24));
      const shouldSend =
        (daysPassed>=5  && daysPassed<6  && config.reminders?.day5)  ||
        (daysPassed>=10 && daysPassed<11 && config.reminders?.day10) ||
        (daysPassed>=15 && daysPassed<16 && config.reminders?.day15);
      if (!shouldSend) continue;

      const portalLink = `${process.env.FRONTEND_URL}/portal/invoices/${inv._id}`;
      const waMsg =
        `Hi ${inv.clientId.ownerName} 👋\n\n` +
        `*SocialFlipss — Payment Reminder* ⚠️\n\n` +
        `Payment for invoice *${inv.invoiceNumber}* is pending:\n\n` +
        `💰 Pending: *₹${Number(inv.pendingAmount).toLocaleString("en-IN")}*\n` +
        `📅 ${daysPassed} days since invoice\n\n` +
        `Portal par payment karo:\n${portalLink}\n\n` +
        `Thank you! 🙏 – SocialFlipss Team`;

      const waLink = inv.clientId.mobile
        ? `https://wa.me/91${inv.clientId.mobile.replace(/\D/g,"")}?text=${encodeURIComponent(waMsg)}`
        : null;

      try {
        await notifyClient({
          clientId:inv.clientId._id, title:"Payment Reminder",
          message:`Invoice ${inv.invoiceNumber} — ₹${inv.pendingAmount.toLocaleString("en-IN")} pending`,
          type:"payment_reminder", invoiceId:inv._id,
          emailData:{ clientName:inv.clientId.ownerName, invoiceNumber:inv.invoiceNumber, pendingAmount:inv.pendingAmount, daysPassed, portalLink },
        });
      } catch(e) { console.error("Email error:", e.message); }

      if (waLink) reminderLinks.push({ client:inv.clientId.businessName, invoice:inv.invoiceNumber, pending:inv.pendingAmount, whatsappLink:waLink });
      sent++;
    }

    res.json({ message:`${sent} reminders processed.`, reminderLinks });
  } catch (err) { res.status(500).json({ message:err.message }); }
});

module.exports = router;
