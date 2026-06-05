const express    = require("express");
const Lead       = require("../models/Lead");
const Client     = require("../models/Client");
const Invoice    = require("../models/Invoice");
const Content    = require("../models/Content");
const Project    = require("../models/Project");
const Reminder   = require("../models/Reminder");
const WorkLog    = require("../models/WorkLog");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/analytics/dashboard — master dashboard data
router.get("/dashboard", async (req, res) => {
  try {
    const now          = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const isAdmin = req.user.role === "admin";

    // ── Counts ───────────────────────────────────────────────────
    const [
      totalLeads, newLeads, convertedLeads,
      totalClients, activeClients,
      totalProjects, activeProjects,
      totalContent, postedContent, pendingContent,
    ] = await Promise.all([
      isAdmin ? Lead.countDocuments() : 0,
      isAdmin ? Lead.countDocuments({ status: "new" }) : 0,
      isAdmin ? Lead.countDocuments({ status: "converted" }) : 0,
      isAdmin ? Client.countDocuments() : 0,
      isAdmin ? Client.countDocuments({ status: "active" }) : 0,
      Project.countDocuments(),
      Project.countDocuments({ status: "active" }),
      Content.countDocuments(),
      Content.countDocuments({ stage: "posted" }),
      Content.countDocuments({ stage: { $in: ["idea","approved","shooting","editing"] } }),
    ]);

    // ── Revenue ──────────────────────────────────────────────────
    let revenue = { total: 0, paid: 0, pending: 0 };
    let thisMonthRevenue = { total: 0, paid: 0 };

    if (isAdmin) {
      const invoiceAgg = await Invoice.aggregate([
        { $group: { _id: null, total: { $sum:"$totalAmount" }, paid: { $sum:"$paidAmount" }, pending: { $sum:"$pendingAmount" } } },
      ]);
      if (invoiceAgg[0]) revenue = invoiceAgg[0];

      // This month revenue
      const thisMonthRevAgg = await Invoice.aggregate([
        { $match: { createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum:"$totalAmount" }, paid: { $sum:"$paidAmount" } } },
      ]);
      if (thisMonthRevAgg[0]) thisMonthRevenue = thisMonthRevAgg[0];
    }

    // ── Monthly Revenue Trend (last 6 months) ────────────────────
    const monthlyRevenue = isAdmin ? await Invoice.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: {
        _id: { y:{ $year:"$createdAt" }, m:{ $month:"$createdAt" } },
        revenue: { $sum:"$totalAmount" },
        paid:    { $sum:"$paidAmount" },
      }},
      { $sort: { "_id.y":1, "_id.m":1 } },
    ]) : [];

    // ── Lead Funnel ──────────────────────────────────────────────
    const leadFunnel = isAdmin ? await Lead.aggregate([
      { $group: { _id:"$status", count:{ $sum:1 } } },
    ]) : [];

    // ── Monthly Lead Trend ───────────────────────────────────────
    const monthlyLeads = isAdmin ? await Lead.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { y:{ $year:"$createdAt" }, m:{ $month:"$createdAt" } }, count:{ $sum:1 } } },
      { $sort:  { "_id.y":1, "_id.m":1 } },
    ]) : [];

    // ── Content Production This Month ────────────────────────────
    const contentThisMonth = await Content.aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      { $group: { _id:"$stage", count:{ $sum:1 } } },
    ]);

    // ── Reminders due today / overdue ────────────────────────────
    const today = new Date(); today.setHours(23,59,59,999);
    const overdueReminders = await Reminder.countDocuments({ done:false, dueDate:{ $lte: today } });

    // ── Pending invoices count ────────────────────────────────────
    const pendingInvoices = isAdmin ? await Invoice.countDocuments({ paymentStatus: { $in:["pending","partial"] } }) : 0;

    // ── Top clients by revenue ───────────────────────────────────
    const topClients = isAdmin ? await Invoice.aggregate([
      { $group: { _id:"$clientId", totalPaid:{ $sum:"$paidAmount" }, totalAmount:{ $sum:"$totalAmount" } } },
      { $sort:  { totalPaid: -1 } },
      { $limit: 5 },
      { $lookup: { from:"clients", localField:"_id", foreignField:"_id", as:"client" } },
      { $unwind: "$client" },
      { $project: { name:"$client.businessName", totalPaid:1, totalAmount:1 } },
    ]) : [];

    // ── Lead sources breakdown ───────────────────────────────────
    const leadSources = isAdmin ? await Lead.aggregate([
      { $group: { _id:"$source", count:{ $sum:1 } } },
      { $sort:  { count:-1 } },
    ]) : [];

    res.json({
      counts: {
        totalLeads, newLeads, convertedLeads,
        totalClients, activeClients,
        totalProjects, activeProjects,
        totalContent, postedContent, pendingContent,
        overdueReminders, pendingInvoices,
      },
      revenue: {
        ...revenue,
        thisMonth: thisMonthRevenue,
      },
      charts: {
        monthlyRevenue,
        monthlyLeads,
        contentThisMonth,
        leadFunnel,
        leadSources,
        topClients,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Analytics error", error: err.message });
  }
});

module.exports = router;
