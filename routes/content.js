const express = require("express");
const Content = require("../models/Content");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/content/stats?projectId= or clientId=
router.get("/stats", async (req, res) => {
  try {
    const { projectId, clientId, month } = req.query;
    const filter = {};
    if (projectId) filter.projectId = projectId;
    if (clientId)  filter.clientId  = clientId;

    const [total, idea, approved, shooting, editing, posted] = await Promise.all([
      Content.countDocuments(filter),
      Content.countDocuments({ ...filter, stage:"idea" }),
      Content.countDocuments({ ...filter, stage:"approved" }),
      Content.countDocuments({ ...filter, stage:"shooting" }),
      Content.countDocuments({ ...filter, stage:"editing" }),
      Content.countDocuments({ ...filter, stage:"posted" }),
    ]);

    // By type breakdown
    const byType = await Content.aggregate([
      { $match: filter },
      { $group: { _id:"$type", count:{ $sum:1 } } },
      { $sort:  { count:-1 } },
    ]);

    res.json({ total, idea, approved, shooting, editing, posted, byType });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/content — list with filters (for kanban and calendar)
router.get("/", async (req, res) => {
  try {
    const { projectId, clientId, stage, assignedTo, type, page = 1, limit = 100 } = req.query;
    const filter = {};
    if (projectId)  filter.projectId  = projectId;
    if (clientId)   filter.clientId   = clientId;
    if (stage)      filter.stage      = stage;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (type)       filter.type       = type;
    if (req.user.role === "team") filter.assignedTo = req.user._id;

    const total   = await Content.countDocuments(filter);
    const content = await Content.find(filter)
      .populate("assignedTo", "name")
      .populate("projectId",  "name month")
      .populate("clientId",   "businessName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ content, total });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/content/:id
router.get("/:id", async (req, res) => {
  try {
    const content = await Content.findById(req.params.id)
      .populate("assignedTo",       "name role")
      .populate("projectId",        "name month")
      .populate("clientId",         "businessName ownerName")
      .populate("comments.addedBy", "name");
    if (!content) return res.status(404).json({ message: "Not found" });
    res.json(content);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/content
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const item = await Content.create({ ...req.body, createdBy: req.user._id });
    const populated = await item.populate(["assignedTo","projectId","clientId"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/content/:id — update any field including stage
router.put("/:id", async (req, res) => {
  try {
    // If moving to "posted", set postedAt timestamp
    if (req.body.stage === "posted" && !req.body.postedAt) {
      req.body.postedAt = new Date();
    }
    const item = await Content.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("assignedTo", "name")
      .populate("projectId",  "name")
      .populate("clientId",   "businessName");
    if (!item) return res.status(404).json({ message: "Not found" });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/content/:id/comment — add comment
router.post("/:id/comment", async (req, res) => {
  try {
    const { text } = req.body;
    const item = await Content.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { text, addedBy: req.user._id } } },
      { new: true }
    ).populate("comments.addedBy", "name");
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/content/:id/comment/:commentId
router.delete("/:id/comment/:commentId", authorize("admin", "manager"), async (req, res) => {
  try {
    await Content.findByIdAndUpdate(req.params.id, {
      $pull: { comments: { _id: req.params.commentId } },
    });
    res.json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/content/:id
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    await Content.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
