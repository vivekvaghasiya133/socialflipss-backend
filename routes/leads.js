const express = require("express");
const Lead    = require("../models/Lead");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect); // All lead routes need login

// GET /api/leads/stats — dashboard numbers
router.get("/stats", async (req, res) => {
  try {
    const total         = await Lead.countDocuments();
    const newLeads      = await Lead.countDocuments({ status: "new" });
    const followUp      = await Lead.countDocuments({ status: "follow_up" });
    const converted     = await Lead.countDocuments({ status: "converted" });
    const notInterested = await Lead.countDocuments({ status: "not_interested" });

    // Follow-ups due today or overdue
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const dueTodayOrOverdue = await Lead.countDocuments({
      nextFollowUp: { $lte: today },
      status:       { $in: ["new", "follow_up"] },
    });

    // Source breakdown
    const bySource = await Lead.aggregate([
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
    ]);

    // Last 30 days trend
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentLeads   = await Lead.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

    res.json({ total, newLeads, followUp, converted, notInterested, dueTodayOrOverdue, bySource, recentLeads });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/leads — list with filter/search/paginate
router.get("/", async (req, res) => {
  try {
    const { status, source, assignedTo, search, page = 1, limit = 20, dueSoon } = req.query;
    const filter = {};

    if (status)     filter.status     = status;
    if (source)     filter.source     = source;
    if (assignedTo) filter.assignedTo = assignedTo;

    // Team members see only their assigned leads
    if (req.user.role === "team") filter.assignedTo = req.user._id;

    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options: "i" } },
        { contactName:  { $regex: search, $options: "i" } },
        { mobile:       { $regex: search, $options: "i" } },
      ];
    }

    // Due soon filter (follow-ups due today or overdue)
    if (dueSoon === "true") {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      filter.nextFollowUp = { $lte: today };
      filter.status       = { $in: ["new", "follow_up"] };
    }

    const total = await Lead.countDocuments(filter);
    const leads = await Lead.find(filter)
      .populate("assignedTo", "name role")
      .populate("createdBy",  "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select("-activities"); // Exclude activities from list view for performance

    res.json({ leads, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/leads/:id — single lead with activities
router.get("/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedTo", "name role position")
      .populate("createdBy",  "name")
      .populate("activities.addedBy", "name");
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/leads — create lead
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user._id };

    // ✅ FIX: handle empty assignedTo
    if (!data.assignedTo || data.assignedTo === "") {
      data.assignedTo = null; // OR delete data.assignedTo;
    }

    const lead = await Lead.create(data);

    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/leads/:id — update lead
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("assignedTo", "name role");
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/leads/:id/activity — add call/meeting/note
router.post("/:id/activity", async (req, res) => {
  try {
    const { type, note, date } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    lead.activities.push({ type, note, date: date || new Date(), addedBy: req.user._id });
    lead.lastCommunication = note;
    lead.lastContactDate   = date || new Date();
    await lead.save();

    const updated = await Lead.findById(req.params.id).populate("activities.addedBy", "name");
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/leads/:id/activity/:actId
router.delete("/:id/activity/:actId", authorize("admin", "manager"), async (req, res) => {
  try {
    await Lead.findByIdAndUpdate(req.params.id, {
      $pull: { activities: { _id: req.params.actId } },
    });
    res.json({ message: "Activity deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/leads/:id
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ message: "Lead deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
