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

module.exports = router;
