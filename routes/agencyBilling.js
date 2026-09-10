const express = require('express');
const router = express.Router();
const ProductionTask = require('../models/ProductionTask');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const { protect } = require('../middleware/auth');

// ── Helper: Generate sequential invoice number ──
async function generateInvoiceNumber() {
  const now = new Date();
  const prefix = `SF-AG-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const count = await Invoice.countDocuments({ invoiceNumber: { $regex: `^${prefix}` } });
  return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}

// ── RESTRICT ALL AGENCY BILLING ROUTES TO ADMIN & MANAGER ──
router.use(protect, (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "manager") {
    return res.status(403).json({ success: false, message: "Access denied: Admin or Manager only" });
  }
  next();
});

// ── 1. GET ALL AGENCIES WITH STATS ──
router.get('/agencies', protect, async (req, res) => {
  try {
    const agencies = await Client.find({
      $or: [
        { clientType: 'agency' },
        { isQuickClient: true },
        { businessName: { $regex: /agency|media|studios|vardhate/i } }
      ]
    }).select('businessName ownerName mobile email city clientType agencyRates isQuickClient createdAt').sort({ businessName: 1 });

    // Aggregate stats for each agency
    const enrichedAgencies = await Promise.all(agencies.map(async (ag) => {
      const tasks = await ProductionTask.find({ client: ag._id }).select('videoPrice billingStatus stage serviceType');
      const totalReels = tasks.length;
      const unbilledTasks = tasks.filter(t => t.billingStatus === 'unbilled');
      const unbilledReels = unbilledTasks.length;
      const unbilledAmount = unbilledTasks.reduce((sum, t) => sum + (Number(t.videoPrice) || 0), 0);
      const totalAmount = tasks.reduce((sum, t) => sum + (Number(t.videoPrice) || 0), 0);

      return {
        ...ag.toObject(),
        totalReels,
        unbilledReels,
        unbilledAmount,
        totalAmount,
      };
    }));

    res.json({ success: true, agencies: enrichedAgencies });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 1B. CREATE NEW AGENCY DIRECTLY ──
router.post('/agencies', protect, async (req, res) => {
  try {
    const { businessName, ownerName, mobile, email, city, agencyRates } = req.body;
    if (!businessName || !ownerName || !mobile) {
      return res.status(400).json({ success: false, message: 'Agency Name, Contact Person, and Mobile are required.' });
    }

    const agency = new Client({
      businessName,
      ownerName,
      mobile,
      email: email || '',
      city: city || 'Surat',
      clientType: 'agency',
      status: 'active',
      agencyRates: agencyRates || { defaultShootRate: 0, defaultEditRate: 0, defaultFullRate: 0 },
      createdBy: req.user._id,
    });

    await agency.save();
    res.json({ success: true, agency, message: 'New Agency partner created successfully! 🤝' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── 1C. UPDATE AGENCY DETAILS & DEFAULT RATES ──
router.put('/agencies/:id', protect, async (req, res) => {
  try {
    const { businessName, ownerName, mobile, email, city, agencyRates } = req.body;
    const agency = await Client.findById(req.params.id);
    if (!agency) return res.status(404).json({ success: false, message: 'Agency not found' });

    if (businessName) agency.businessName = businessName;
    if (ownerName) agency.ownerName = ownerName;
    if (mobile) agency.mobile = mobile;
    if (email !== undefined) agency.email = email;
    if (city !== undefined) agency.city = city;
    if (agencyRates) {
      agency.agencyRates = {
        defaultShootRate: Number(agencyRates.defaultShootRate) || 0,
        defaultEditRate: Number(agencyRates.defaultEditRate) || 0,
        defaultFullRate: Number(agencyRates.defaultFullRate) || 0,
      };
    }

    await agency.save();
    res.json({ success: true, agency, message: 'Agency details and rates updated successfully! ✨' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 2. UPDATE CLIENT TYPE TO AGENCY ──
router.put('/agencies/:id/convert', protect, async (req, res) => {
  try {
    const { clientType, agencyRates } = req.body;
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    if (clientType) client.clientType = clientType;
    if (agencyRates) client.agencyRates = { ...client.agencyRates, ...agencyRates };
    await client.save();

    res.json({ success: true, client, message: 'Client agency settings updated!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 3. GET AGENCY TASKS SUMMARY FOR BILLING ──
router.get('/summary', protect, async (req, res) => {
  try {
    const { agencyId, month, statusFilter } = req.query;
    if (!agencyId) {
      return res.status(400).json({ success: false, message: 'agencyId is required' });
    }

    const agency = await Client.findById(agencyId);
    if (!agency) return res.status(404).json({ success: false, message: 'Agency not found' });

    const query = { client: agencyId };
    if (statusFilter && statusFilter !== 'all') {
      query.billingStatus = statusFilter;
    }

    // If month specified (e.g., '2026-09')
    if (month && month.includes('-')) {
      const [year, m] = month.split('-').map(Number);
      const start = new Date(year, m - 1, 1);
      const end = new Date(year, m, 0, 23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    const tasks = await ProductionTask.find(query)
      .populate('shooter', 'name')
      .populate('editor', 'name')
      .sort({ reelNumber: 1, createdAt: 1 });

    let totalShootCount = 0;
    let totalEditCount = 0;
    let totalFullCount = 0;
    let totalAmount = 0;
    let unbilledAmount = 0;

    tasks.forEach(t => {
      const type = t.serviceType || 'full';
      if (type === 'only_shooting') totalShootCount++;
      else if (type === 'only_editing') totalEditCount++;
      else totalFullCount++;

      const price = Number(t.videoPrice) || 0;
      totalAmount += price;
      if (t.billingStatus === 'unbilled') unbilledAmount += price;
    });

    res.json({
      success: true,
      agency,
      stats: {
        totalTasks: tasks.length,
        totalShootCount,
        totalEditCount,
        totalFullCount,
        totalAmount,
        unbilledAmount
      },
      tasks
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. GENERATE AGENCY INVOICE ──
router.post('/generate-invoice', protect, async (req, res) => {
  try {
    const { agencyId, month, taskIds, notes, discount = 0, gstPercent = 0 } = req.body;
    if (!agencyId || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Agency and at least one task are required.' });
    }

    const agency = await Client.findById(agencyId);
    if (!agency) return res.status(404).json({ success: false, message: 'Agency not found' });

    const tasks = await ProductionTask.find({ _id: { $in: taskIds }, client: agencyId });
    if (tasks.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid tasks found for billing.' });
    }

    // Build line items
    const items = tasks.map(t => {
      const typeLabel = t.serviceType === 'only_editing'
        ? '✂️ Only Editing'
        : t.serviceType === 'only_shooting'
        ? '🎥 Only Shooting'
        : '🎬 Shooting + Editing';

      const rate = Number(t.videoPrice) || 0;
      return {
        description: `Reel #${t.reelNumber}: ${t.title} [${typeLabel}]`,
        quantity: 1,
        rate: rate,
        amount: rate
      };
    });

    const subtotal = items.reduce((acc, it) => acc + it.amount, 0);
    const disc = Number(discount) || 0;
    const gstRate = Number(gstPercent) || 0;
    const taxable = Math.max(0, subtotal - disc);
    const gstAmount = Math.round((taxable * gstRate) / 100);
    const totalAmount = taxable + gstAmount;

    const invoiceNumber = await generateInvoiceNumber();

    const invoice = new Invoice({
      invoiceNumber,
      clientId: agency._id,
      clientName: agency.ownerName || agency.businessName,
      clientBusiness: agency.businessName,
      clientMobile: agency.mobile || '',
      clientEmail: agency.email || '',
      clientCity: agency.city || '',
      month: month || new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' }),
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days credit
      items,
      subtotal,
      discount: disc,
      gstPercent: gstRate,
      gstAmount,
      totalAmount,
      paidAmount: 0,
      pendingAmount: totalAmount,
      paymentStatus: 'pending',
      invoiceType: 'agency_monthly',
      agencyId: agency._id,
      taskIds: tasks.map(t => t._id),
      notes: notes || `Monthly B2B Production Bill for ${agency.businessName}`,
      createdBy: req.user._id
    });

    await invoice.save();

    // Mark tasks as billed
    await ProductionTask.updateMany(
      { _id: { $in: taskIds } },
      {
        $set: {
          billingStatus: 'billed',
          invoiceId: invoice._id,
          billingMonth: month || new Date().toISOString().slice(0, 7)
        }
      }
    );

    // WhatsApp Message
    const waMsg =
      `*SocialFlipss — Agency Monthly Bill* 🧾\n\n` +
      `Hello ${agency.ownerName || agency.businessName} 👋\n\n` +
      `Tamaro *${invoice.month}* no video production bill ready chhe:\n\n` +
      `📄 Invoice No: *${invoice.invoiceNumber}*\n` +
      `🎬 Total Videos: *${tasks.length} Reels*\n` +
      `💰 Total Amount: *₹${totalAmount.toLocaleString('en-IN')}*\n\n` +
      `Payment due date: ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}\n\n` +
      `Thank you for partnering with SocialFlipss! 🚀`;

    res.json({
      success: true,
      message: `Agency Invoice ${invoiceNumber} generated for ${tasks.length} videos! 🧾`,
      invoice,
      whatsappMessage: waMsg
    });
  } catch (err) {
    console.error('generate-invoice error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── 5. DELETE OR UNTAG AGENCY ──
router.delete('/agencies/:id', protect, async (req, res) => {
  try {
    const { action = 'delete' } = req.query; // 'untag' or 'delete'
    const agency = await Client.findById(req.params.id);
    if (!agency) return res.status(404).json({ success: false, message: 'Agency not found' });

    if (action === 'untag') {
      agency.clientType = 'direct';
      agency.isQuickClient = false;
      await agency.save();
      return res.json({ success: true, message: `Agency tag removed for ${agency.businessName}. Moved to regular clients! 🤝` });
    }

    await Client.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Agency "${agency.businessName}" deleted successfully! 🗑️` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── 6. GET ALL AGENCY INVOICES WITH STATS & LEDGER ──
router.get("/invoices", protect, async (req, res) => {
  try {
    const { agencyId, paymentStatus } = req.query;
    const filter = {
      $or: [
        { invoiceType: "agency_monthly" },
        { agencyId: { $ne: null } }
      ]
    };

    if (agencyId) {
      filter.$and = [
        { $or: [{ agencyId: agencyId }, { clientId: agencyId }] }
      ];
    }

    if (paymentStatus === "pending") {
      filter.paymentStatus = { $in: ["pending", "partial"] };
    } else if (paymentStatus === "paid") {
      filter.paymentStatus = "paid";
    } else if (paymentStatus === "partial") {
      filter.paymentStatus = "partial";
    }

    const invoices = await Invoice.find(filter)
      .populate("agencyId", "businessName ownerName mobile email city")
      .populate("clientId", "businessName ownerName mobile email city")
      .populate("createdBy", "name")
      .populate("payments.addedBy", "name")
      .sort({ createdAt: -1 });

    // Aggregate statistics across all agency invoices (or filtered agency)
    const statsFilter = {
      $or: [
        { invoiceType: "agency_monthly" },
        { agencyId: { $ne: null } }
      ]
    };
    if (agencyId) {
      statsFilter.$and = [
        { $or: [{ agencyId: agencyId }, { clientId: agencyId }] }
      ];
    }
    const allMatching = await Invoice.find(statsFilter).select("totalAmount paidAmount pendingAmount paymentStatus");

    let totalInvoiced = 0;
    let totalPaid = 0;
    let totalPending = 0;
    let countPending = 0;
    let countPaid = 0;

    allMatching.forEach(inv => {
      totalInvoiced += (Number(inv.totalAmount) || 0);
      totalPaid += (Number(inv.paidAmount) || 0);
      const pend = (Number(inv.pendingAmount) || 0);
      totalPending += pend;
      if (inv.paymentStatus === "paid") {
        countPaid++;
      } else {
        countPending++;
      }
    });

    res.json({
      success: true,
      invoices,
      stats: {
        totalInvoiced,
        totalPaid,
        totalPending,
        countPending,
        countPaid,
        totalInvoices: allMatching.length
      }
    });
  } catch (err) {
    console.error("get agency invoices error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 7. RECORD PAYMENT FOR AGENCY INVOICE ──
router.post("/invoices/:id/payment", protect, async (req, res) => {
  try {
    const { amount, method = "upi", note = "", date, collectedBy = "vivek", collectedByCustom = "" } = req.body;
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const payAmount = parseFloat(amount);
    if (isNaN(payAmount) || payAmount <= 0) {
      return res.status(400).json({ success: false, message: "Please enter a valid amount greater than 0" });
    }

    if (invoice.paidAmount + payAmount > invoice.totalAmount + 0.01) {
      return res.status(400).json({
        success: false,
        message: `Amount exceeds pending dues. Maximum payable is ₹${invoice.pendingAmount}`
      });
    }

    invoice.payments.push({
      amount: payAmount,
      method,
      note: note || "",
      date: date || new Date(),
      addedBy: req.user._id,
      collectedBy,
      collectedByCustom
    });

    invoice.paidAmount = parseFloat((invoice.paidAmount + payAmount).toFixed(2));
    await invoice.save();

    // If fully paid, mark all linked ProductionTasks as paid
    if (invoice.paymentStatus === "paid" && invoice.taskIds && invoice.taskIds.length > 0) {
      await ProductionTask.updateMany(
        { _id: { $in: invoice.taskIds } },
        { $set: { billingStatus: "paid" } }
      );
    }

    const populated = await Invoice.findById(invoice._id)
      .populate("agencyId", "businessName ownerName mobile email city")
      .populate("clientId", "businessName ownerName mobile email city")
      .populate("createdBy", "name")
      .populate("payments.addedBy", "name");

    res.json({
      success: true,
      message: `Payment of ₹${payAmount.toLocaleString("en-IN")} recorded successfully! 💰`,
      invoice: populated
    });
  } catch (err) {
    console.error("record payment error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 8. 1-CLICK MARK AS FULLY PAID & CLEAR ──
router.put("/invoices/:id/clear", protect, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const remaining = Number(invoice.pendingAmount) || Math.max(0, invoice.totalAmount - invoice.paidAmount);
    if (remaining > 0) {
      invoice.payments.push({
        amount: remaining,
        method: req.body.method || "bank",
        note: req.body.note || "Full balance cleared by Admin",
        date: req.body.date || new Date(),
        addedBy: req.user._id,
        collectedBy: req.body.collectedBy || "vivek",
        collectedByCustom: ""
      });
      invoice.paidAmount = invoice.totalAmount;
    }

    invoice.pendingAmount = 0;
    invoice.paymentStatus = "paid";
    await invoice.save();

    if (invoice.taskIds && invoice.taskIds.length > 0) {
      await ProductionTask.updateMany(
        { _id: { $in: invoice.taskIds } },
        { $set: { billingStatus: "paid" } }
      );
    }

    const populated = await Invoice.findById(invoice._id)
      .populate("agencyId", "businessName ownerName mobile email city")
      .populate("clientId", "businessName ownerName mobile email city")
      .populate("createdBy", "name")
      .populate("payments.addedBy", "name");

    res.json({
      success: true,
      message: `Invoice ${invoice.invoiceNumber} is now 100% CLEAR! 🎉`,
      invoice: populated
    });
  } catch (err) {
    console.error("clear invoice error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 9. REMOVE A PAYMENT RECORD ──
router.delete("/invoices/:id/payment/:payId", protect, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    const payment = invoice.payments.id(req.params.payId);
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

    invoice.paidAmount = Math.max(0, parseFloat((invoice.paidAmount - payment.amount).toFixed(2)));
    invoice.payments.pull(req.params.payId);
    await invoice.save();

    if (invoice.paymentStatus !== "paid" && invoice.taskIds && invoice.taskIds.length > 0) {
      await ProductionTask.updateMany(
        { _id: { $in: invoice.taskIds } },
        { $set: { billingStatus: "billed" } }
      );
    }

    const populated = await Invoice.findById(invoice._id)
      .populate("agencyId", "businessName ownerName mobile email city")
      .populate("clientId", "businessName ownerName mobile email city")
      .populate("createdBy", "name")
      .populate("payments.addedBy", "name");

    res.json({ success: true, message: "Payment record removed!", invoice: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 10. DELETE INVOICE & REVERT TASKS TO UNBILLED ──
router.delete("/invoices/:id", protect, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: "Invoice not found" });

    // Restore linked tasks back to unbilled
    if (invoice.taskIds && invoice.taskIds.length > 0) {
      await ProductionTask.updateMany(
        { _id: { $in: invoice.taskIds } },
        { $set: { billingStatus: "unbilled", invoiceId: null, billingMonth: "" } }
      );
    }

    await Invoice.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: `Invoice ${invoice.invoiceNumber} deleted and tasks restored to unbilled! 🗑️` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
