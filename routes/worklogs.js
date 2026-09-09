const express        = require("express");
const mongoose       = require("mongoose");
const WorkLog        = require("../models/WorkLog");
const User           = require("../models/User");
const Staff          = require("../models/Staff");
const ProductionTask = require("../models/ProductionTask");
const StaffTimeLog   = require("../models/StaffTimeLog");
const Client         = require("../models/Client");
const { protect }    = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// ── HELPER: Resolve all matching User & Staff IDs for a staff / user query ──
async function resolveTargetUserAndStaffIds({ userId, staffId, email, name, reqUser }) {
  let userIds = [];
  let staffDocs = [];

  // Team members strictly see only their own data
  if (reqUser && reqUser.role === "team") {
    userIds.push(reqUser._id);
    const s = await Staff.findOne({
      $or: [
        { email: { $regex: new RegExp("^" + (reqUser.email || "").trim() + "$", "i") } },
        { name: { $regex: new RegExp("^" + (reqUser.name || "").trim() + "$", "i") } }
      ]
    });
    if (s) {
      staffDocs.push(s);
      userIds.push(s._id);
    }
    return {
      userIds: [...new Set(userIds.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id)),
      staffDocs
    };
  }

  // 1. Direct staffId
  if (staffId && mongoose.Types.ObjectId.isValid(staffId)) {
    const s = await Staff.findById(staffId);
    if (s) staffDocs.push(s);
  }

  // 2. Direct email
  if (email && email.trim()) {
    const cleanEmail = email.trim().toLowerCase();
    const uList = await User.find({ email: { $regex: new RegExp("^" + cleanEmail + "$", "i") } });
    uList.forEach(u => userIds.push(u._id));
    const sList = await Staff.find({ email: { $regex: new RegExp("^" + cleanEmail + "$", "i") } });
    sList.forEach(s => staffDocs.push(s));
  }

  // 3. Direct name
  if (name && name.trim()) {
    const cleanName = name.trim();
    const uList = await User.find({ name: { $regex: new RegExp("^" + cleanName + "$", "i") } });
    uList.forEach(u => userIds.push(u._id));
    const sList = await Staff.find({ name: { $regex: new RegExp("^" + cleanName + "$", "i") } });
    sList.forEach(s => staffDocs.push(s));
  }

  // 4. Direct userId
  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    userIds.push(new mongoose.Types.ObjectId(userId));
    const u = await User.findById(userId);
    if (u) {
      const s = await Staff.findOne({
        $or: [
          { email: { $regex: new RegExp("^" + (u.email || "").trim() + "$", "i") } },
          { name: { $regex: new RegExp("^" + (u.name || "").trim() + "$", "i") } }
        ]
      });
      if (s) staffDocs.push(s);
    }
  }

  // Cross-link staff docs to users
  for (const s of staffDocs) {
    userIds.push(s._id);
    if (s.email) {
      const uList = await User.find({ email: { $regex: new RegExp("^" + (s.email || "").trim() + "$", "i") } });
      uList.forEach(u => userIds.push(u._id));
    }
    if (s.name) {
      const uList = await User.find({ name: { $regex: new RegExp("^" + (s.name || "").trim() + "$", "i") } });
      uList.forEach(u => userIds.push(u._id));
    }
  }

  const uniqueUserIds = [...new Set(userIds.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id));
  return { userIds: uniqueUserIds, staffDocs };
}

// ── HELPER: Aggregate all daily work logs, video shoots, edits, and timelogs ──
async function aggregateWorkLogs({ userIds, date, month, clientId, projectId }) {
  const allLogs = [];
  const byDate = {};

  // 1. Manual WorkLog collection records
  const workLogFilter = {};
  if (date)  workLogFilter.date = date;
  if (month) workLogFilter.date = { $regex: "^" + month };
  if (clientId)  workLogFilter.clientId  = clientId;
  if (projectId) workLogFilter.projectId = projectId;
  if (userIds.length > 0) workLogFilter.userId = { $in: userIds };

  const manualLogs = await WorkLog.find(workLogFilter)
    .populate("userId", "name role")
    .populate("clientId", "businessName")
    .populate("projectId", "name")
    .sort({ date: -1, createdAt: -1 });

  manualLogs.forEach(m => {
    const dStr = m.date;
    allLogs.push({
      _id: m._id,
      date: dStr,
      workType: m.workType || "general",
      description: m.description || "Manual Work Log",
      videosCreated: m.videosCreated || 0,
      videosEdited: m.videosEdited || 0,
      postsDesigned: m.postsDesigned || 0,
      hoursWorked: m.hoursWorked || 0,
      items: m.items || [],
      clientId: m.clientId || null,
      projectId: m.projectId || null,
      userId: m.userId || null,
      source: "worklog"
    });

    if (!byDate[dStr]) byDate[dStr] = { date: dStr, videosCreated: 0, videosEdited: 0, totalVideos: 0, details: [] };
    byDate[dStr].videosCreated += (m.videosCreated || 0);
    byDate[dStr].videosEdited += (m.videosEdited || 0);
    byDate[dStr].totalVideos += ((m.videosCreated || 0) + (m.videosEdited || 0));
    if (m.description) byDate[dStr].details.push(m.description);
  });

  // 2. ProductionTask collection (Shoots, Video Edits, Scripts)
  const taskFilter = {};
  if (userIds.length > 0) {
    taskFilter.$or = [
      { shooter: { $in: userIds } },
      { editor: { $in: userIds } },
      { writer: { $in: userIds } },
      { createdBy: { $in: userIds } }
    ];
  }
  if (clientId) taskFilter.client = clientId;

  const tasks = await ProductionTask.find(taskFilter)
    .populate("client", "businessName")
    .populate("shooter", "name role email")
    .populate("editor", "name role email")
    .populate("writer", "name role email")
    .sort({ updatedAt: -1, createdAt: -1 });

  const strUserIds = userIds.map(id => id.toString());

  tasks.forEach(task => {
    const clientName = task.client?.businessName || "Client";
    const isShooter = task.shooter && strUserIds.includes(task.shooter._id.toString());
    const isEditor  = task.editor  && strUserIds.includes(task.editor._id.toString());
    const isWriter  = task.writer  && strUserIds.includes(task.writer._id.toString());

    // A. Shoot Operations (Videos Shot / Made)
    if (isShooter || (strUserIds.length === 0 && task.shooter)) {
      const shootDateStr = task.shootDate || 
        (task.shootCompletedAt ? new Date(task.shootCompletedAt).toISOString().slice(0, 10) : "") ||
        new Date(task.createdAt).toISOString().slice(0, 10);

      if ((!date || shootDateStr === date) && (!month || shootDateStr.startsWith(month))) {
        const vCount = (task.completedReels > 0) ? task.completedReels : (task.targetReels || 1);
        const statusLabel = task.shootStatus === "done" ? "Shoot Completed" : "Shoot Scheduled";
        const desc = "Shot " + vCount + " Reel(s) for " + clientName + " - Reel #" + (task.reelNumber || 1) + ": " + task.title + " (" + statusLabel + ")";

        allLogs.push({
          _id: "prod-shoot-" + task._id,
          date: shootDateStr,
          workType: "shooting",
          description: desc,
          videosCreated: vCount,
          videosEdited: 0,
          postsDesigned: 0,
          hoursWorked: 0,
          items: [{
            name: clientName,
            videosCreated: vCount,
            videosEdited: 0,
            title: task.title,
            reelNumber: task.reelNumber || 1,
            stage: task.stage,
            status: task.shootStatus
          }],
          clientId: task.client || null,
          userId: task.shooter || null,
          source: "production_shoot"
        });

        if (!byDate[shootDateStr]) byDate[shootDateStr] = { date: shootDateStr, videosCreated: 0, videosEdited: 0, totalVideos: 0, details: [] };
        byDate[shootDateStr].videosCreated += vCount;
        byDate[shootDateStr].totalVideos += vCount;
        byDate[shootDateStr].details.push("🎬 " + vCount + " Video(s) Shot: " + clientName + " (Reel #" + (task.reelNumber || 1) + ")");
      }
    }

    // B. Video Editing Operations (Videos Edited)
    if (isEditor || (strUserIds.length === 0 && task.editor)) {
      const editDateStr = (task.editingCompletedAt ? new Date(task.editingCompletedAt).toISOString().slice(0, 10) : "") ||
        (task.stage !== "script" && task.stage !== "shoot" ? new Date(task.updatedAt).toISOString().slice(0, 10) : "") ||
        new Date(task.createdAt).toISOString().slice(0, 10);

      if ((!date || editDateStr === date) && (!month || editDateStr.startsWith(month))) {
        const vEdited = task.reelsCountCredited || 1;
        const stageLabel = (task.stage || "edit").toUpperCase();
        const desc = "Edited Reel #" + (task.reelNumber || 1) + ": " + task.title + " for " + clientName + " (Stage: " + stageLabel + ")";

        allLogs.push({
          _id: "prod-edit-" + task._id,
          date: editDateStr,
          workType: "video_editing",
          description: desc,
          videosCreated: 0,
          videosEdited: vEdited,
          postsDesigned: 0,
          hoursWorked: 0,
          items: [{
            name: clientName,
            videosCreated: 0,
            videosEdited: vEdited,
            title: task.title,
            reelNumber: task.reelNumber || 1,
            stage: task.stage,
            status: task.editingStatus
          }],
          clientId: task.client || null,
          userId: task.editor || null,
          source: "production_edit"
        });

        if (!byDate[editDateStr]) byDate[editDateStr] = { date: editDateStr, videosCreated: 0, videosEdited: 0, totalVideos: 0, details: [] };
        byDate[editDateStr].videosEdited += vEdited;
        byDate[editDateStr].totalVideos += vEdited;
        byDate[editDateStr].details.push("✍️ " + vEdited + " Video(s) Edited: " + clientName + " (Reel #" + (task.reelNumber || 1) + ")");
      }
    }

    // C. Script Writing Operations
    if (isWriter || (strUserIds.length === 0 && task.writer)) {
      const scriptDateStr = (task.scriptApprovedAt ? new Date(task.scriptApprovedAt).toISOString().slice(0, 10) : "") ||
        new Date(task.createdAt).toISOString().slice(0, 10);

      if ((!date || scriptDateStr === date) && (!month || scriptDateStr.startsWith(month))) {
        const desc = "Wrote Script for Reel #" + (task.reelNumber || 1) + ": " + task.title + " (" + clientName + ")";
        allLogs.push({
          _id: "prod-script-" + task._id,
          date: scriptDateStr,
          workType: "content_writing",
          description: desc,
          videosCreated: 1,
          videosEdited: 0,
          postsDesigned: 0,
          hoursWorked: 0,
          items: [{
            name: clientName,
            videosCreated: 1,
            videosEdited: 0,
            title: task.title,
            reelNumber: task.reelNumber || 1,
            stage: "script"
          }],
          clientId: task.client || null,
          userId: task.writer || null,
          source: "production_script"
        });

        if (!byDate[scriptDateStr]) byDate[scriptDateStr] = { date: scriptDateStr, videosCreated: 0, videosEdited: 0, totalVideos: 0, details: [] };
        byDate[scriptDateStr].videosCreated += 1;
        byDate[scriptDateStr].totalVideos += 1;
        byDate[scriptDateStr].details.push("📝 Script: " + clientName + " (Reel #" + (task.reelNumber || 1) + ")");
      }
    }
  });

  // 3. StaffTimeLog collection (Punch in/out daily tracked output)
  const timeLogFilter = {};
  if (userIds.length > 0) timeLogFilter.user = { $in: userIds };
  if (date) timeLogFilter.date = date;
  if (month) timeLogFilter.date = { $regex: "^" + month };

  const timeLogs = await StaffTimeLog.find(timeLogFilter).populate("user", "name role");

  timeLogs.forEach(tl => {
    const dStr = tl.date;
    const hours = parseFloat(((tl.totalWorkMinutes || 0) / 60).toFixed(1));
    const hasOutput = (tl.shootsCompletedCount > 0 || tl.reelsEditedCount > 0);

    if (hasOutput || hours > 0) {
      const existingForDay = allLogs.filter(l => l.date === dStr);
      if (existingForDay.length === 0) {
        allLogs.push({
          _id: "timelog-" + tl._id,
          date: dStr,
          workType: tl.shootsCompletedCount > 0 ? "shooting" : tl.reelsEditedCount > 0 ? "video_editing" : "attendance",
          description: "Daily Punch Log: " + (tl.shootsCompletedCount || 0) + " Shoot(s) Done, " + (tl.reelsEditedCount || 0) + " Reel(s) Edited (" + (tl.totalWorkMinutes || 0) + " mins worked)",
          videosCreated: tl.shootsCompletedCount || 0,
          videosEdited: tl.reelsEditedCount || 0,
          postsDesigned: 0,
          hoursWorked: hours,
          items: [],
          clientId: null,
          userId: tl.user || null,
          source: "staff_timelog"
        });

        if (!byDate[dStr]) byDate[dStr] = { date: dStr, videosCreated: 0, videosEdited: 0, totalVideos: 0, details: [] };
        byDate[dStr].videosCreated += (tl.shootsCompletedCount || 0);
        byDate[dStr].videosEdited += (tl.reelsEditedCount || 0);
        byDate[dStr].totalVideos += ((tl.shootsCompletedCount || 0) + (tl.reelsEditedCount || 0));
        byDate[dStr].details.push("⏱️ " + hours + "h worked (" + (tl.shootsCompletedCount || 0) + " shoots, " + (tl.reelsEditedCount || 0) + " reels edited)");
      } else {
        existingForDay[0].hoursWorked = Math.max(existingForDay[0].hoursWorked || 0, hours);
      }
    }
  });

  // Sort descending by date
  allLogs.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return { allLogs, byDate };
}

// ── GET /api/worklogs?userId=&staffId=&email=&name=&date=&month=YYYY-MM ──
router.get("/", async (req, res) => {
  try {
    const { userId, staffId, email, name, date, month, clientId, projectId } = req.query;
    const { userIds } = await resolveTargetUserAndStaffIds({ userId, staffId, email, name, reqUser: req.user });

    const { allLogs } = await aggregateWorkLogs({
      userIds,
      date,
      month,
      clientId,
      projectId
    });

    res.json(allLogs);
  } catch (err) {
    console.error("GET /api/worklogs error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/worklogs/stats?month=YYYY-MM&staffId=&email=&userId=&name= ──
router.get("/stats", async (req, res) => {
  try {
    const { month, userId, staffId, email, name } = req.query;
    const { userIds } = await resolveTargetUserAndStaffIds({ userId, staffId, email, name, reqUser: req.user });

    const { allLogs, byDate } = await aggregateWorkLogs({
      userIds,
      month,
      clientId: null,
      projectId: null
    });

    const totalVideos       = allLogs.reduce((s, l) => s + (l.videosCreated || 0), 0);
    const totalVideosEdited = allLogs.reduce((s, l) => s + (l.videosEdited || 0), 0);
    const totalPosts        = allLogs.reduce((s, l) => s + (l.postsDesigned || 0), 0);
    const totalHours        = allLogs.reduce((s, l) => s + (l.hoursWorked  || 0), 0);
    const totalShoots       = allLogs.filter(l => l.workType === "shooting").length;

    // By work type
    const byType = {};
    allLogs.forEach(l => { byType[l.workType] = (byType[l.workType] || 0) + 1; });

    res.json({
      totalVideos,
      totalVideosEdited,
      totalPosts,
      totalHours: parseFloat(totalHours.toFixed(1)),
      totalShoots,
      byType,
      byDate,
      totalLogs: allLogs.length
    });
  } catch (err) {
    console.error("GET /api/worklogs/stats error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/worklogs ──
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

// ── PUT /api/worklogs/:id ──
router.put("/:id", async (req, res) => {
  try {
    const log = await WorkLog.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate(["userId","clientId","projectId"]);
    res.json(log);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── DELETE /api/worklogs/:id ──
router.delete("/:id", async (req, res) => {
  try {
    await WorkLog.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
