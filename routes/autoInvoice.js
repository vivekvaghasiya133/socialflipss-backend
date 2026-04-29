// ADD this route to existing backend/routes/autoInvoice.js
// GET /api/auto-invoice/all — list all configured clients

const express           = require("express");
const AutoInvoiceConfig = require("../models/AutoInvoiceConfig");
const Invoice           = require("../models/Invoice");
const Client            = require("../models/Client");
const { protect, authorize } = require("../middleware/auth");

// NOTE: This is a PATCH file — copy the /all route below into your
// existing autoInvoice.js BEFORE module.exports

// router.get("/all", authorize("admin","manager"), async (req, res) => {
//   try {
//     const configs = await AutoInvoiceConfig.find()
//       .populate("clientId", "businessName ownerName _id")
//       .sort({ createdAt: -1 });
//     res.json(configs);
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// });

// ─── FULL UPDATED autoInvoice.js (replace existing) ──────────────────────────

const router = express.Router();
router.use(protect);

async function generateInvoiceNumber() {
  const now    = new Date();
  const prefix = `SF-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const count  = await Invoice.countDocuments({ invoiceNumber:{ $regex:`^${prefix}` } });
  return `${prefix}-${String(count+1).padStart(3,"0")}`;
}

// GET /api/auto-invoice/all
router.get("/all", authorize("admin","manager"), async (req, res) => {
  try {
    const configs = await AutoInvoiceConfig.find()
      .populate("clientId","businessName ownerName _id")
      .sort({ createdAt:-1 });
    res.json(configs);
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

router.post("/setup", authorize("admin","manager"), async (req, res) => {
  try {
    const { clientId, packageAmount, packageName, gstPercent, extraItems, notes, reminders, enabled } = req.body;
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ message:"Client not found" });
    const dayOfMonth = new Date(client.onboardingDate||client.createdAt).getDate();
    const config = await AutoInvoiceConfig.findOneAndUpdate(
      { clientId },
      { clientId, dayOfMonth, packageAmount:packageAmount||0, packageName:packageName||"Monthly Service",
        gstPercent:gstPercent||0, extraItems:extraItems||[], notes:notes||"",
        reminders:reminders||{ day5:true, day10:true, day15:true },
        enabled: enabled !== undefined ? enabled : true, createdBy:req.user._id },
      { upsert:true, new:true }
    );
    res.json({ message:"Auto invoice configured!", config, dayOfMonth });
  } catch (err) {
    res.status(400).json({ message:err.message });
  }
});

router.get("/:clientId", async (req, res) => {
  try {
    const config = await AutoInvoiceConfig.findOne({ clientId:req.params.clientId });
    res.json(config||null);
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

router.post("/generate/:clientId", authorize("admin","manager"), async (req, res) => {
  try {
    const config = await AutoInvoiceConfig.findOne({ clientId:req.params.clientId });
    if (!config) return res.status(404).json({ message:"Auto invoice not configured" });
    const client     = await Client.findById(req.params.clientId);
    const now        = new Date();
    const month      = `${now.toLocaleString("en-IN",{month:"long"})} ${now.getFullYear()}`;
    const dueDate    = new Date(now); dueDate.setDate(dueDate.getDate()+15);
    const invoiceNum = await generateInvoiceNumber();
    const subtotal   = config.packageAmount + (config.extraItems||[]).reduce((s,i)=>s+i.amount,0);
    const gstAmount  = parseFloat((subtotal*(config.gstPercent||0)/100).toFixed(2));
    const total      = parseFloat((subtotal+gstAmount).toFixed(2));
    const items      = [
      { description:config.packageName||"Monthly Service", quantity:1, rate:config.packageAmount, amount:config.packageAmount },
      ...(config.extraItems||[]).map(e=>({ description:e.description, quantity:1, rate:e.amount, amount:e.amount })),
    ];
    const invoice = await Invoice.create({ invoiceNumber:invoiceNum, clientId:client._id, month, issueDate:now, dueDate, items, subtotal, gstPercent:config.gstPercent||0, gstAmount, totalAmount:total, paidAmount:0, pendingAmount:total, notes:config.notes, createdBy:req.user._id });
    config.lastGeneratedMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    config.lastGeneratedAt    = now;
    config.totalGenerated    += 1;
    await config.save();
    const { notifyClient } = require("../utils/notifier");
    const portalLink = `${process.env.FRONTEND_URL}/portal/invoices/${invoice._id}`;
    await notifyClient({ clientId:client._id, title:`Invoice — ${month}`, message:`₹${total.toLocaleString("en-IN")}`, type:"invoice_generated", invoiceId:invoice._id, emailData:{ clientName:client.ownerName, invoiceNumber:invoiceNum, amount:total, month, dueDate:dueDate.toLocaleDateString("en-IN"), portalLink } });
    res.json({ message:"Invoice generated!", invoice });
  } catch (err) {
    res.status(400).json({ message:err.message });
  }
});

router.post("/run-auto", authorize("admin"), async (req, res) => {
  try {
    const today  = new Date();
    const day    = today.getDate();
    const month  = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}`;
    const configs= await AutoInvoiceConfig.find({ enabled:true, dayOfMonth:day, $or:[{ lastGeneratedMonth:{ $ne:month } },{ lastGeneratedMonth:null }] });
    const results= [];
    for (const config of configs) {
      try {
        const client = await Client.findById(config.clientId);
        if (!client||client.status!=="active") continue;
        const invoiceNum= await generateInvoiceNumber();
        const now       = new Date();
        const monthLabel= `${now.toLocaleString("en-IN",{month:"long"})} ${now.getFullYear()}`;
        const dueDate   = new Date(now); dueDate.setDate(dueDate.getDate()+15);
        const subtotal  = config.packageAmount+(config.extraItems||[]).reduce((s,i)=>s+i.amount,0);
        const gstAmount = parseFloat((subtotal*(config.gstPercent||0)/100).toFixed(2));
        const total     = parseFloat((subtotal+gstAmount).toFixed(2));
        const items     = [{ description:config.packageName||"Monthly Service", quantity:1, rate:config.packageAmount, amount:config.packageAmount }, ...(config.extraItems||[]).map(e=>({ description:e.description, quantity:1, rate:e.amount, amount:e.amount }))];
        const invoice   = await Invoice.create({ invoiceNumber:invoiceNum, clientId:client._id, month:monthLabel, issueDate:now, dueDate, items, subtotal, gstPercent:config.gstPercent||0, gstAmount, totalAmount:total, paidAmount:0, pendingAmount:total });
        config.lastGeneratedMonth=month; config.lastGeneratedAt=now; config.totalGenerated+=1; await config.save();
        const { notifyClient } = require("../utils/notifier");
        await notifyClient({ clientId:client._id, title:`Invoice — ${monthLabel}`, message:`₹${total.toLocaleString("en-IN")}`, type:"invoice_generated", invoiceId:invoice._id, emailData:{ clientName:client.ownerName, invoiceNumber:invoiceNum, amount:total, month:monthLabel, dueDate:dueDate.toLocaleDateString("en-IN"), portalLink:`${process.env.FRONTEND_URL}/portal/invoices/${invoice._id}` } });
        results.push({ client:client.businessName, invoice:invoiceNum, amount:total });
      } catch (err) { results.push({ error:err.message, clientId:config.clientId }); }
    }
    res.json({ message:`Auto-run complete. ${results.filter(r=>!r.error).length} invoices generated.`, results });
  } catch (err) {
    res.status(500).json({ message:err.message });
  }
});

router.post("/send-reminders", authorize("admin","manager"), async (req, res) => {
  try {
    const now             = new Date();
    const pendingInvoices = await Invoice.find({ paymentStatus:{ $in:["pending","partial"] } }).populate("clientId","businessName ownerName _id");
    let sent = 0;
    for (const inv of pendingInvoices) {
      const config = await AutoInvoiceConfig.findOne({ clientId:inv.clientId._id });
      if (!config) continue;
      const daysPassed = Math.floor((now-new Date(inv.createdAt))/(1000*60*60*24));
      const shouldSend =
        (daysPassed>=5 &&daysPassed<6  &&config.reminders?.day5)  ||
        (daysPassed>=10&&daysPassed<11 &&config.reminders?.day10) ||
        (daysPassed>=15&&daysPassed<16 &&config.reminders?.day15);
      if (!shouldSend) continue;
      const { notifyClient } = require("../utils/notifier");
      await notifyClient({ clientId:inv.clientId._id, title:"Payment Reminder", message:`Invoice ${inv.invoiceNumber} — ₹${inv.pendingAmount.toLocaleString("en-IN")} pending`, type:"payment_reminder", invoiceId:inv._id, emailData:{ clientName:inv.clientId.ownerName, invoiceNumber:inv.invoiceNumber, pendingAmount:inv.pendingAmount, daysPassed, portalLink:`${process.env.FRONTEND_URL}/portal/invoices/${inv._id}` } });
      sent++;
    }
    res.json({ message:`${sent} payment reminders sent.` });
  } catch (err) {
    res.status(500).json({ message:err.message });
  }
});

module.exports = router;
