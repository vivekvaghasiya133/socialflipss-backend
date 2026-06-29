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
  const invoices = await Invoice.find(
    { invoiceNumber: { $regex: `^${prefix}-` } },
    { invoiceNumber: 1 }
  );

  let maxNum = 0;
  for (const inv of invoices) {
    const parts = inv.invoiceNumber.split("-");
    const numPart = parts[parts.length - 1];
    const num = parseInt(numPart, 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(3, "0")}`;
}

// GET /api/invoices/stats — revenue overview
router.get("/stats", authorize("admin"), async (req, res) => {
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
    let { clientId, items = [], discount = 0, gstPercent = 0 } = req.body;
    if (!clientId) clientId = null;

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
      clientId,
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

// PUT /api/invoices/:id — update invoice
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    // Extract fields we want to allow updating
    const {
      clientId,
      clientName,
      clientBusiness,
      clientMobile,
      clientEmail,
      clientCity,
      month,
      issueDate,
      dueDate,
      items,
      discount,
      gstPercent,
      notes
    } = req.body;

    if (clientId !== undefined) invoice.clientId = clientId || null;
    if (clientName !== undefined) invoice.clientName = clientName || "";
    if (clientBusiness !== undefined) invoice.clientBusiness = clientBusiness || "";
    if (clientMobile !== undefined) invoice.clientMobile = clientMobile || "";
    if (clientEmail !== undefined) invoice.clientEmail = clientEmail || "";
    if (clientCity !== undefined) invoice.clientCity = clientCity || "";
    if (month !== undefined) invoice.month = month || "";
    if (issueDate !== undefined) invoice.issueDate = issueDate || Date.now();
    if (dueDate !== undefined) invoice.dueDate = dueDate || null;
    if (notes !== undefined) invoice.notes = notes || "";

    if (items !== undefined) {
      // Calculate amounts
      const subtotal = items.reduce((s, i) => s + (Number(i.quantity || 1) * Number(i.rate || 0)), 0);
      const discVal = Number(discount !== undefined ? discount : invoice.discount || 0);
      const gstPct = Number(gstPercent !== undefined ? gstPercent : invoice.gstPercent || 0);
      const gstAmount = parseFloat(((subtotal - discVal) * gstPct / 100).toFixed(2));
      const total = parseFloat((subtotal - discVal + gstAmount).toFixed(2));

      invoice.items = items.map((i) => ({
        description: i.description,
        quantity: Number(i.quantity || 1),
        rate: Number(i.rate || 0),
        amount: parseFloat((Number(i.quantity || 1) * Number(i.rate || 0)).toFixed(2)),
      }));
      invoice.subtotal = subtotal;
      invoice.discount = discVal;
      invoice.gstPercent = gstPct;
      invoice.gstAmount = gstAmount;
      invoice.totalAmount = total;
    } else {
      // If items not updated but discount or gstPercent updated
      let recalculate = false;
      if (discount !== undefined && discount !== invoice.discount) {
        invoice.discount = Number(discount);
        recalculate = true;
      }
      if (gstPercent !== undefined && gstPercent !== invoice.gstPercent) {
        invoice.gstPercent = Number(gstPercent);
        recalculate = true;
      }
      if (recalculate) {
        const subtotal = invoice.subtotal;
        const gstAmount = parseFloat(((subtotal - invoice.discount) * invoice.gstPercent / 100).toFixed(2));
        const total = parseFloat((subtotal - invoice.discount + gstAmount).toFixed(2));
        invoice.gstAmount = gstAmount;
        invoice.totalAmount = total;
      }
    }

    // save() will trigger the pre-save hook to calculate pendingAmount and paymentStatus
    await invoice.save();
    
    // Return populated invoice
    const populated = await Invoice.findById(invoice._id)
      .populate("clientId", "businessName ownerName mobile email city")
      .populate("createdBy", "name")
      .populate("payments.addedBy", "name");
      
    res.json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/invoices/:id/payment — record a payment
router.post("/:id/payment", authorize("admin", "manager"), async (req, res) => {
  try {
    const { amount, method, note, date, collectedBy, collectedByCustom } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const payAmount = parseFloat(amount);
    if (payAmount <= 0) return res.status(400).json({ message: "Amount must be > 0" });
    if (invoice.paidAmount + payAmount > invoice.totalAmount)
      return res.status(400).json({ message: `Max payable: ₹${invoice.pendingAmount}` });

    invoice.payments.push({
      amount: payAmount,
      method,
      note: note||"",
      date: date||new Date(),
      addedBy: req.user._id,
      collectedBy: collectedBy || "vivek",
      collectedByCustom: collectedByCustom || ""
    });
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
