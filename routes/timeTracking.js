const express = require("express");
const router  = express.Router();
const StaffTimeLog = require("../models/StaffTimeLog");
const User         = require("../models/User");
const { protect }  = require("../middleware/auth");

const getTodayStr = () => new Date().toISOString().split("T")[0];

// ── 1. GET CURRENT USER'S TIME STATUS TODAY ──
router.get("/status", protect, async (req, res) => {
  try {
    const today = getTodayStr();
    let log = await StaffTimeLog.findOne({ user: req.user._id, date: today });

    if (!log) {
      return res.json({
        success: true,
        punchedIn: false,
        status: "not_punched_in",
        log: null,
      });
    }

    const activeBreak = log.breaks.find(b => !b.endTime);

    res.json({
      success: true,
      punchedIn: log.status !== "punched_out",
      status: log.status,
      activeBreak: activeBreak || null,
      log,
    });
  } catch (err) {
    console.error("GET /time-tracking/status error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 2. PUNCH IN ──
router.post("/punch-in", protect, async (req, res) => {
  try {
    const today = getTodayStr();
    let log = await StaffTimeLog.findOne({ user: req.user._id, date: today });

    if (log && log.status !== "punched_out") {
      return res.status(400).json({ success: false, message: "Already punched in for today!" });
    }

    if (!log) {
      log = new StaffTimeLog({
        user: req.user._id,
        date: today,
        punchInTime: new Date(),
        punchInLocation: req.body.location || "Office",
        status: "punched_in",
      });
    } else {
      // Re-punch in case of re-entry
      log.status = "punched_in";
      log.punchInTime = new Date();
    }

    await log.save();
    res.json({ success: true, message: "Punched in successfully! Have a great day! ✨", log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 3. START BREAK ──
router.post("/start-break", protect, async (req, res) => {
  try {
    const today = getTodayStr();
    const log = await StaffTimeLog.findOne({ user: req.user._id, date: today });

    if (!log || log.status === "punched_out") {
      return res.status(400).json({ success: false, message: "You must be punched in to take a break." });
    }

    const hasActiveBreak = log.breaks.some(b => !b.endTime);
    if (hasActiveBreak) {
      return res.status(400).json({ success: false, message: "A break is already active!" });
    }

    log.breaks.push({
      startTime: new Date(),
      reason: req.body.reason || "lunch",
      note: req.body.note || "",
    });
    log.status = "on_break";

    await log.save();
    res.json({ success: true, message: "Break started. Enjoy your break! ☕", log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. END BREAK ──
router.post("/end-break", protect, async (req, res) => {
  try {
    const today = getTodayStr();
    const log = await StaffTimeLog.findOne({ user: req.user._id, date: today });

    if (!log) return res.status(400).json({ success: false, message: "No time log found today." });

    const currentBreak = log.breaks.find(b => !b.endTime);
    if (!currentBreak) {
      return res.status(400).json({ success: false, message: "No active break found to end." });
    }

    const endTime = new Date();
    currentBreak.endTime = endTime;
    const durationMins = Math.max(1, Math.round((endTime - new Date(currentBreak.startTime)) / 60000));
    currentBreak.durationMinutes = durationMins;

    // Recalculate total break minutes
    log.totalBreakMinutes = log.breaks.reduce((acc, b) => acc + (b.durationMinutes || 0), 0);
    log.status = "punched_in";

    await log.save();
    res.json({ success: true, message: `Break ended (${durationMins} mins). Back to work! 🚀`, log });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 5. PUNCH OUT ──
router.post("/punch-out", protect, async (req, res) => {
  try {
    const today = getTodayStr();
    const log = await StaffTimeLog.findOne({ user: req.user._id, date: today });

    if (!log || log.status === "punched_out") {
      return res.status(400).json({ success: false, message: "Not currently punched in." });
    }

    // If currently on break, end it first
    const activeBreak = log.breaks.find(b => !b.endTime);
    if (activeBreak) {
      activeBreak.endTime = new Date();
      activeBreak.durationMinutes = Math.max(1, Math.round((activeBreak.endTime - new Date(activeBreak.startTime)) / 60000));
      log.totalBreakMinutes = log.breaks.reduce((acc, b) => acc + (b.durationMinutes || 0), 0);
    }

    const punchOutTime = new Date();
    log.punchOutTime = punchOutTime;
    log.punchOutLocation = req.body.location || "Office";
    log.status = "punched_out";

    // Calculate total net work minutes (Total time - break time)
    const rawMinutes = Math.round((punchOutTime - new Date(log.punchInTime)) / 60000);
    log.totalWorkMinutes = Math.max(0, rawMinutes - log.totalBreakMinutes);

    await log.save();
    res.json({
      success: true,
      message: `Punched out! Total working time: ${Math.floor(log.totalWorkMinutes / 60)}h ${log.totalWorkMinutes % 60}m. See you tomorrow! 👋`,
      log,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 6. ADMIN DAILY TEAM LEADERBOARD & LIVE STATUS ──
router.get("/team-overview", protect, async (req, res) => {
  try {
    const today = req.query.date || getTodayStr();
    const [allUsers, logsToday] = await Promise.all([
      User.find({ status: "active" }).select("name email role position avatar").lean(),
      StaffTimeLog.find({ date: today }).lean(),
    ]);

    const logMap = {};
    logsToday.forEach(l => {
      logMap[l.user.toString()] = l;
    });

    const teamOverview = allUsers.map(u => {
      const log = logMap[u._id.toString()];
      return {
        userId: u._id,
        name: u.name,
        role: u.role,
        position: u.position || "Team Member",
        avatar: u.avatar,
        status: log ? log.status : "absent",
        punchInTime: log ? log.punchInTime : null,
        punchOutTime: log ? log.punchOutTime : null,
        totalBreakMinutes: log ? log.totalBreakMinutes : 0,
        totalWorkMinutes: log ? log.totalWorkMinutes : 0,
        reelsEdited: log ? log.reelsEditedCount : 0,
        shootsDone: log ? log.shootsCompletedCount : 0,
      };
    });

    res.json({ success: true, date: today, team: teamOverview });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
