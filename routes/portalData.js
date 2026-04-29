const express      = require("express");
const Content      = require("../models/Content");
const Invoice      = require("../models/Invoice");
const ShootSchedule= require("../models/ShootSchedule");
const Notification = require("../models/Notification");
const Client       = require("../models/Client");
const { protectClient } = require("../middleware/clientAuth");
const { notifyAdmin }   = require("../utils/notifier");

const router = express.Router();
router.use(protectClient);

const clientId = (req) => req.clientAuth.clientId;

// ── Dashboard stats ───────────────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  try {
    const cid = clientId(req);
    const [totalContent, postedContent, pendingApproval, invoices, unreadNotifs] = await Promise.all([
      Content.countDocuments({ clientId: cid }),
      Content.countDocuments({ clientId: cid, stage: "posted" }),
      Content.countDocuments({ clientId: cid, clientApproved: false, stage: { $in:["approved","editing"] } }),
      Invoice.find({ clientId: cid }).select("totalAmount paidAmount pendingAmount paymentStatus month createdAt").sort({ createdAt:-1 }).limit(3),
      Notification.countDocuments({ recipientId: cid, read: false }),
    ]);

    const totalPaid    = invoices.reduce((s,i) => s + i.paidAmount, 0);
    const totalPending = invoices.reduce((s,i) => s + i.pendingAmount, 0);

    // Upcoming shoots
    const today    = new Date().toISOString().slice(0,10);
    const schedule = await ShootSchedule.findOne({ clientId: cid });
    const upcomingShoot = schedule?.slots?.find(s => s.date >= today && s.status === "scheduled") || null;

    res.json({
      totalContent, postedContent, pendingApproval,
      totalPaid, totalPending, unreadNotifs,
      recentInvoices: invoices,
      upcomingShoot,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── Content list ──────────────────────────────────────────────────
router.get("/content", async (req, res) => {
  try {
    const { stage, type, page=1, limit=20 } = req.query;
    const filter = { clientId: clientId(req) };
    if (stage) filter.stage = stage;
    if (type)  filter.type  = type;

    const total   = await Content.countDocuments(filter);
    const content = await Content.find(filter)
      .populate("assignedTo", "name")
      .populate("projectId",  "name month")
      .sort({ createdAt:-1 })
      .skip((page-1)*limit).limit(Number(limit));

    res.json({ content, total });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── Content approval ──────────────────────────────────────────────
// PUT /api/portal/content/:id/approve
router.put("/content/:id/approve", async (req, res) => {
  try {
    const { status, comment } = req.body;
    // status: "approved" | "rejected" | "changes_requested"
    if (!["approved","rejected","changes_requested"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const content = await Content.findOne({ _id: req.params.id, clientId: clientId(req) });
    if (!content) return res.status(404).json({ message: "Content not found" });

    content.clientApproved = status === "approved";
    content.approvalNote   = comment || "";
    if (status !== "approved") content.stage = "idea"; // push back to idea if rejected/changes
    if (comment) content.comments.push({ text: `[Client] ${comment}`, addedBy: null });
    await content.save();

    // Notify admin
    await notifyAdmin({
      title:     `Content ${status} by client`,
      message:   `${req.clientRecord.businessName} ne "${content.title}" ko ${status} kiya${comment ? `: ${comment}` : ""}`,
      type:      status === "approved" ? "content_approved" : "content_rejected",
      link:      `/admin/projects/${content.projectId}`,
      clientId:  clientId(req),
      contentId: content._id,
    });

    res.json({ message: `Content ${status}!`, content });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── Invoices ──────────────────────────────────────────────────────
router.get("/invoices", async (req, res) => {
  try {
    const invoices = await Invoice.find({ clientId: clientId(req) })
      .sort({ createdAt:-1 });
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/invoices/:id", async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ _id: req.params.id, clientId: clientId(req) });
    if (!invoice) return res.status(404).json({ message: "Not found" });
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── Shoot schedule ────────────────────────────────────────────────
router.get("/shoot-schedule", async (req, res) => {
  try {
    const schedules = await ShootSchedule.find({ clientId: clientId(req) })
      .populate("projectId", "name month")
      .sort({ createdAt:-1 });
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── Notifications ─────────────────────────────────────────────────
router.get("/notifications", async (req, res) => {
  try {
    const notifs = await Notification.find({ recipientId: clientId(req) })
      .sort({ createdAt:-1 }).limit(50);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/notifications/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read:true, readAt:new Date() });
    res.json({ message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.put("/notifications/read-all", async (req, res) => {
  try {
    await Notification.updateMany({ recipientId: clientId(req), read:false }, { read:true, readAt:new Date() });
    res.json({ message: "All marked as read" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
