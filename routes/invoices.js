const express = require("express");
const Invoice = require("../models/Invoice");
const Client  = require("../models/Client");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// ── Invoice number generator ──────────────────────────────────────
async function generateInvoiceNumber() {
  const now    = new Date();
  const prefix = `SF-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2,"0")}`;
  const count  = await Invoice.countDocuments({
    invoiceNumber: { $regex: `^${prefix}` },
  });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
}

// GET /api/invoices/stats — revenue overview
router.get("/stats", async (req, res) => {
  try {
    const all = await Invoice.find();

    const totalRevenue   = all.reduce((s, i) => s + i.totalAmount, 0);
    const totalPaid      = all.reduce((s, i) => s + i.paidAmount,  0);
    const totalPending   = all.reduce((s, i) => s + i.pendingAmount, 0);
    const countPending   = all.filter((i) => i.paymentStatus === "pending").length;
    const countPartial   = all.filter((i) => i.paymentStatus === "partial").length;
    const countPaid      = all.filter((i) => i.paymentStatus === "paid").length;

    // Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyRevenue = await Invoice.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { y: { $year:"$createdAt" }, m: { $month:"$createdAt" } }, revenue: { $sum:"$totalAmount" }, paid: { $sum:"$paidAmount" } } },
      { $sort: { "_id.y":1, "_id.m":1 } },
    ]);

    res.json({ totalRevenue, totalPaid, totalPending, countPending, countPartial, countPaid, monthlyRevenue });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/invoices — list all invoices
router.get("/", async (req, res) => {
  try {
    const { clientId, paymentStatus, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (clientId)     filter.clientId     = clientId;
    if (paymentStatus) filter.paymentStatus = paymentStatus;

    const total    = await Invoice.countDocuments(filter);
    const invoices = await Invoice.find(filter)
      .populate("clientId", "businessName ownerName mobile")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ invoices, total });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/invoices/:id
router.get("/:id", async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("clientId",  "businessName ownerName mobile email city")
      .populate("createdBy", "name")
      .populate("payments.addedBy", "name");
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/invoices — create invoice
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const invoiceNumber = await generateInvoiceNumber();
    const { items = [], discount = 0, gstPercent = 0 } = req.body;

    // Calculate amounts
    const subtotal  = items.reduce((s, i) => s + (i.quantity * i.rate), 0);
    const gstAmount = parseFloat(((subtotal - discount) * gstPercent / 100).toFixed(2));
    const total     = parseFloat((subtotal - discount + gstAmount).toFixed(2));

    // Build items with amount field
    const processedItems = items.map((i) => ({
      ...i, amount: parseFloat((i.quantity * i.rate).toFixed(2)),
    }));

    const invoice = await Invoice.create({
      ...req.body,
      invoiceNumber,
      items:       processedItems,
      subtotal,
      gstAmount,
      totalAmount: total,
      paidAmount:  0,
      pendingAmount: total,
      createdBy:   req.user._id,
    });

    res.status(201).json(invoice);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/invoices/:id — update invoice (before payment)
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const invoice = await Invoice.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(invoice);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/invoices/:id/payment — record a payment
router.post("/:id/payment", authorize("admin", "manager"), async (req, res) => {
  try {
    const { amount, method, note, date } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const payAmount = parseFloat(amount);
    if (payAmount <= 0) return res.status(400).json({ message: "Amount must be > 0" });
    if (invoice.paidAmount + payAmount > invoice.totalAmount)
      return res.status(400).json({ message: `Max payable: ₹${invoice.pendingAmount}` });

    invoice.payments.push({ amount: payAmount, method, note: note||"", date: date||new Date(), addedBy: req.user._id });
    invoice.paidAmount = parseFloat((invoice.paidAmount + payAmount).toFixed(2));
    await invoice.save(); // pre-save hook updates pendingAmount + paymentStatus

    const populated = await Invoice.findById(invoice._id)
      .populate("clientId", "businessName")
      .populate("payments.addedBy", "name");
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/invoices/:id/payment/:payId
router.delete("/:id/payment/:payId", authorize("admin"), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    const payment = invoice.payments.id(req.params.payId);
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    invoice.paidAmount = parseFloat((invoice.paidAmount - payment.amount).toFixed(2));
    invoice.payments.pull(req.params.payId);
    await invoice.save();
    res.json({ message: "Payment removed" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/invoices/:id
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ message: "Invoice deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
