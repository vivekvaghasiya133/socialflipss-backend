const express  = require("express");
const mongoose = require("mongoose");
const WorkLog  = require("../models/WorkLog");
const User     = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/worklogs?userId=&date=&month=YYYY-MM
router.get("/", async (req, res) => {
  try {
    const { userId, date, month, clientId, projectId, email } = req.query;
    const filter = {};
    if (date)      filter.date      = date;
    if (month)     filter.date      = { $regex: `^${month}` };
    if (clientId)  filter.clientId  = clientId;
    if (projectId) filter.projectId = projectId;

    // Team sees only their own logs
    if (req.user.role === "team") {
      filter.userId = req.user._id;
    } else if (email) {
      const u = await User.findOne({ email: email.toLowerCase() });
      if (u) filter.userId = u._id;
      else filter.userId = new mongoose.Types.ObjectId(); // force empty if email not found
    } else if (userId) {
      filter.userId = userId;
    }

    const logs = await WorkLog.find(filter)
      .populate("userId",    "name role")
      .populate("clientId",  "businessName")
      .populate("projectId", "name")
      .sort({ date: -1, createdAt: -1 });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/worklogs/stats?month=YYYY-MM
router.get("/stats", async (req, res) => {
  try {
    const { month, userId, email } = req.query;
    const filter = month ? { date: { $regex: `^${month}` } } : {};
    
    if (req.user.role === "team") {
      filter.userId = req.user._id;
    } else if (email) {
      const u = await User.findOne({ email: email.toLowerCase() });
      if (u) filter.userId = u._id;
      else filter.userId = new mongoose.Types.ObjectId();
    } else if (userId) {
      filter.userId = userId;
    }

    const logs = await WorkLog.find(filter);

    const totalVideos       = logs.reduce((s, l) => s + (l.videosCreated || 0), 0);
    const totalVideosEdited = logs.reduce((s, l) => s + (l.videosEdited || 0), 0);
    const totalPosts        = logs.reduce((s, l) => s + (l.postsDesigned || 0), 0);
    const totalHours        = logs.reduce((s, l) => s + (l.hoursWorked  || 0), 0);

    // By work type
    const byType = {};
    logs.forEach(l => { byType[l.workType] = (byType[l.workType] || 0) + 1; });

    // By user
    const byUser = await WorkLog.aggregate([
      { $match: filter },
      { $group: { _id:"$userId", videos:{ $sum:"$videosCreated" }, videosEdited:{ $sum:"$videosEdited" }, posts:{ $sum:"$postsDesigned" }, hours:{ $sum:"$hoursWorked" }, logs:{ $sum:1 } } },
    ]);

    res.json({ totalVideos, totalVideosEdited, totalPosts, totalHours, byType, byUser, totalLogs: logs.length });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/worklogs
router.post("/", async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.items && data.items.length > 0) {
      data.videosCreated = data.items.reduce((sum, item) => sum + Number(item.videosCreated || 0), 0);
      data.videosEdited  = data.items.reduce((sum, item) => sum + Number(item.videosEdited || 0), 0);
    }
    const log = await WorkLog.create({
      ...data,
      userId:  data.userId || req.user._id,
      addedBy: req.user._id,
    });
    const populated = await log.populate(["userId","clientId","projectId"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/worklogs/:id
router.put("/:id", async (req, res) => {
  try {
    const log = await WorkLog.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate(["userId","clientId","projectId"]);
    res.json(log);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/worklogs/:id
router.delete("/:id", async (req, res) => {
  try {
    await WorkLog.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
