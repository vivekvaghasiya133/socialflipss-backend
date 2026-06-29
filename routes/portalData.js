const express      = require("express");
const Content      = require("../models/Content");
const Project      = require("../models/Project");
const Invoice      = require("../models/Invoice");
const ShootSchedule= require("../models/ShootSchedule");
const Notification = require("../models/Notification");
const Client       = require("../models/Client");
const Strategy     = require("../models/Strategy");
const { protectClient } = require("../middleware/clientAuth");
const { notifyAdmin }   = require("../utils/notifier");

const router = express.Router();
router.use(protectClient);

const clientId = (req) => req.clientAuth.clientId;

// ── Dashboard stats ───────────────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  try {
    const cid = clientId(req);
    const [totalContent, postedContent, pendingReels, pendingScripts, invoices, unreadNotifs] = await Promise.all([
      Content.countDocuments({ clientId: cid, stage: { $ne: "idea" } }),
      Content.countDocuments({ clientId: cid, stage: "posted" }),
      Content.countDocuments({ clientId: cid, clientApproved: false, stage: "client_approval" }),
      Content.countDocuments({ clientId: cid, scriptApproved: false, stage: "script", scriptText: { $exists: true, $ne: "" } }),
      Invoice.find({ clientId: cid }).select("totalAmount paidAmount pendingAmount paymentStatus month createdAt").sort({ createdAt:-1 }).limit(3),
      Notification.countDocuments({ recipientId: cid, read: false }),
    ]);

    const pendingApproval = pendingReels + pendingScripts;

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
    if (stage) {
      if (stage === "idea") {
        return res.json({ content: [], total: 0 });
      }
      filter.stage = stage;
    } else {
      filter.stage = { $ne: "idea" };
    }
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
// PUT /api/portal/content/:id/approve — Final Video/Reel Approval
router.put("/content/:id/approve", async (req, res) => {
  try {
    const { status, comment } = req.body;
    // status: "approved" | "rejected" | "changes_requested"
    if (!["approved","rejected","changes_requested"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const content = await Content.findOne({ _id: req.params.id, clientId: clientId(req) });
    if (!content) return res.status(404).json({ message: "Content not found" });

    if (status === "approved") {
      content.clientApproved = true;
    } else {
      content.clientApproved = false;
      if (status === "changes_requested") {
        content.stage = "edit"; // Push back to editor stage
      } else if (status === "rejected") {
        content.stage = "idea";
      }
    }
    content.clientApprovalStatus = status;
    content.approvalNote   = comment || "";
    if (comment) content.comments.push({ text: `[Client] ${comment}`, addedBy: null });
    await content.save();

    // Notify admin
    await notifyAdmin({
      title:     `Reel ${status} by client`,
      message:   `${req.clientRecord.businessName} ne video/reel "${content.title}" ko ${status} kiya${comment ? `: ${comment}` : ""}`,
      type:      status === "approved" ? "content_approved" : "content_rejected",
      link:      `/admin/project-kanban/${content.projectId}`,
      clientId:  clientId(req),
      contentId: content._id,
    });

    res.json({ message: `Reel ${status}!`, content });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/portal/content/:id/approve-script — Script Approval
router.put("/content/:id/approve-script", async (req, res) => {
  try {
    const { status, comment } = req.body;
    // status: "approved" | "rejected" | "changes_requested"
    if (!["approved","rejected","changes_requested"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const content = await Content.findOne({ _id: req.params.id, clientId: clientId(req) });
    if (!content) return res.status(404).json({ message: "Content not found" });

    if (status === "approved") {
      content.scriptApproved = true;
      content.stage = "shoot"; // Move to shoot stage for shoot scheduling
    } else {
      content.scriptApproved = false;
      if (status === "changes_requested") {
        content.stage = "script"; // Keep in script stage for revisions
      } else if (status === "rejected") {
        content.stage = "idea";
      }
    }
    content.scriptApprovalStatus = status;
    content.scriptApprovalNote   = comment || "";
    if (comment) content.comments.push({ text: `[Client Script Feedback] ${comment}`, addedBy: null });
    await content.save();

    // Notify admin
    await notifyAdmin({
      title:     `Script ${status} by client`,
      message:   `${req.clientRecord.businessName} ne script "${content.title}" ko ${status} kiya${comment ? `: ${comment}` : ""}`,
      type:      status === "approved" ? "content_approved" : "content_rejected",
      link:      `/admin/project-kanban/${content.projectId}`,
      clientId:  clientId(req),
      contentId: content._id,
    });

    res.json({ message: `Script ${status}!`, content });
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

// ── Strategy Review ───────────────────────────────────────────────
// GET /api/portal/strategy - Get the active strategy for client
router.get("/strategy", async (req, res) => {
  try {
    const cid = clientId(req);
    // Find the latest strategy in Review or Approved status for this client
    let strategy = await Strategy.findOne({ clientId: cid, status: { $in: ["Review", "Approved"] } })
      .populate("strategist", "name")
      .sort({ createdAt: -1 });

    if (!strategy) {
      // Fallback: get any latest strategy
      strategy = await Strategy.findOne({ clientId: cid })
        .populate("strategist", "name")
        .sort({ createdAt: -1 });
    }

    if (!strategy) return res.status(404).json({ message: "No monthly strategy found." });

    // Normalize reelTopics for backward compatibility
    const doc = strategy.toObject();
    if (doc.reelTopics && doc.reelTopics.length) {
      doc.reelTopics = doc.reelTopics.map(topic => {
        if (typeof topic === "string") {
          return { title: topic, brief: "", status: "Draft", feedback: "", contentId: null };
        }
        return topic;
      });
    }

    res.json(doc);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// PUT /api/portal/strategy/:id/topics/:topicId/review
router.put("/strategy/:id/topics/:topicId/review", async (req, res) => {
  try {
    const { status, feedback } = req.body;
    // status must be "Approved" or "Changes Requested"
    if (!["Approved", "Changes Requested"].includes(status)) {
      return res.status(400).json({ message: "Invalid review status" });
    }

    const cid = clientId(req);
    const strategy = await Strategy.findOne({ _id: req.params.id, clientId: cid });
    if (!strategy) return res.status(404).json({ message: "Strategy not found" });

    // Find the topic index
    const topicIdx = strategy.reelTopics.findIndex(t => t._id.toString() === req.params.topicId);
    if (topicIdx === -1) return res.status(404).json({ message: "Topic not found in strategy" });

    const topic = strategy.reelTopics[topicIdx];
    topic.status = status;
    topic.feedback = feedback || "";

    // Find or create Project for this client and month to ensure E2E connection
    let project = await Project.findOne({ clientId: cid, month: strategy.month });
    if (!project) {
      const clientRec = await Client.findById(cid);
      const clientName = clientRec ? clientRec.businessName : "Client";
      project = await Project.create({
        clientId: cid,
        name: `${clientName} - ${strategy.month} Plan`,
        month: strategy.month,
        status: "active",
        createdBy: strategy.strategist,
      });
    }

    // If Approved, create Content item in "script" stage
    if (status === "Approved") {
      if (!topic.contentId) {
        const newContent = await Content.create({
          clientId: cid,
          projectId: project._id, // LINKED!
          title: topic.title || "Untitled Reel Topic",
          description: topic.brief || "",
          type: "reel",
          stage: "script", // starts in script stage
          createdBy: strategy.strategist,
        });
        topic.contentId = newContent._id;
      } else {
        // If content already exists, update its details and project linkage
        await Content.findByIdAndUpdate(topic.contentId, {
          projectId: project._id,
          title: topic.title || "Untitled Reel Topic",
          description: topic.brief || "",
        });
      }
    } else if (status === "Changes Requested") {
      // If changes requested, we could optionally push content back or mark it
      // For now, if contentId exists, update its stage/note
      if (topic.contentId) {
        await Content.findByIdAndUpdate(topic.contentId, {
          projectId: project._id,
          stage: "idea", // push back to idea stage
          approvalNote: feedback || "",
        });
      }
    }

    // Mark the subdocument as modified if mongoose didn't catch it
    strategy.markModified("reelTopics");
    await strategy.save();

    // Notify admin/strategist
    await notifyAdmin({
      title: `Strategy Concept ${status}`,
      message: `${req.clientRecord.businessName} has marked topic "${topic.title}" as ${status}${feedback ? `: ${feedback}` : ""}`,
      type: status === "Approved" ? "content_approved" : "content_rejected",
      link: `/admin/strategy-vault`,
      clientId: cid,
    });

    res.json({ message: `Concept review updated!`, topic });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
