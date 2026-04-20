const express  = require("express");
const Project  = require("../models/Project");
const Content  = require("../models/Content");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/projects/stats
router.get("/stats", async (req, res) => {
  try {
    const total     = await Project.countDocuments();
    const active    = await Project.countDocuments({ status: "active" });
    const planning  = await Project.countDocuments({ status: "planning" });
    const completed = await Project.countDocuments({ status: "completed" });
    res.json({ total, active, planning, completed });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/projects — list with filters
router.get("/", async (req, res) => {
  try {
    const { clientId, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (status)   filter.status   = status;
    if (req.user.role === "team") filter.assignedTo = req.user._id;

    const total    = await Project.countDocuments(filter);
    const projects = await Project.find(filter)
      .populate("clientId",   "businessName ownerName")
      .populate("assignedTo", "name")
      .populate("createdBy",  "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Attach content counts
    const projectIds = projects.map(p => p._id);
    const contentCounts = await Content.aggregate([
      { $match: { projectId: { $in: projectIds } } },
      { $group: { _id: "$projectId", total: { $sum: 1 }, posted: { $sum: { $cond: [{ $eq: ["$stage","posted"] }, 1, 0] } } } },
    ]);
    const countMap = {};
    contentCounts.forEach(c => { countMap[c._id.toString()] = c; });

    const result = projects.map(p => ({
      ...p.toObject(),
      contentStats: countMap[p._id.toString()] || { total: 0, posted: 0 },
    }));

    res.json({ projects: result, total });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/projects/:id
router.get("/:id", async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("clientId",   "businessName ownerName mobile instagramPage")
      .populate("assignedTo", "name role")
      .populate("createdBy",  "name");
    if (!project) return res.status(404).json({ message: "Project not found" });
    res.json(project);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/projects
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const project = await Project.create({ ...req.body, createdBy: req.user._id });
    res.status(201).json(project);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/projects/:id
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const project = await Project.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate("clientId",   "businessName ownerName")
      .populate("assignedTo", "name");
    if (!project) return res.status(404).json({ message: "Not found" });
    res.json(project);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/projects/:id
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    await Project.findByIdAndDelete(req.params.id);
    await Content.deleteMany({ projectId: req.params.id });
    res.json({ message: "Project and all content deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
