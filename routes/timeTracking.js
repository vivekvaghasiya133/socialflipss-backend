const express = require("express");
const router  = express.Router();
const StaffTimeLog = require("../models/StaffTimeLog");
const User         = require("../models/User");
const Staff        = require("../models/Staff");
// Sync User status with Staff status and deactivate known duplicates
setTimeout(async () => {
  try {
    const inactiveStaff = await Staff.find({ status: "inactive" }).lean();
    const inactEmails = inactiveStaff.map(s => (s.email || "").toLowerCase().trim()).filter(Boolean);
    const inactNames = inactiveStaff.map(s => (s.name || "").toLowerCase().trim()).filter(Boolean);

    // 1. Deactivate users matching inactive staff
    for (const inact of inactiveStaff) {
      if (inact.email) {
        await User.updateMany(
          { email: inact.email.toLowerCase().trim(), role: { $nin: ["admin"] } },
          { $set: { status: "inactive" } }
        );
      }
      if (inact.name) {
        await User.updateMany(
          { name: new RegExp("^" + inact.name.trim() + "$", "i"), role: { $nin: ["admin"] } },
          { $set: { status: "inactive" } }
        );
      }
    }

    // 2. Ensure users matching ACTIVE staff are strictly set to active!
    const activeStaff = await Staff.find({ status: "active" }).lean();
    for (const act of activeStaff) {
      if (act.email) {
        await User.updateMany(
          { email: act.email.toLowerCase().trim() },
          { $set: { status: "active" } }
        );
      }
      if (act.name) {
        await User.updateMany(
          { name: new RegExp("^" + act.name.trim() + "$", "i") },
          { $set: { status: "active" } }
        );
      }
    }

    // 3. Deactivate specific known duplicate accounts & activate primary Jay Panchali
    await User.updateMany(
      { email: { $in: ["mordiyavaibhavi18@gmail.com", "jaypanchali@gmail.com"] } },
      { $set: { status: "inactive" } }
    );
    await User.updateOne(
      { email: "jaypanchani0607@gmail.com" },
      { $set: { status: "active", name: "Jay Panchali", position: "Shooter", role: "shooter" } }
    );

    console.log("✓ User active/inactive status synced with Staff directory");
  } catch (e) {
    console.error("User sync error:", e);
  }
}, 1500);


const { protect }  = require("../middleware/auth");

const getTodayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

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

    const isWorking = log.status === "punched_in";
    const isBreak = log.status === "on_break";
    const isOut = log.status === "punched_out";

    res.json({
      success: true,
      punchedIn: !isOut,
      isPunchedIn: isWorking || isBreak,
      isOnBreak: isBreak,
      isPunchedOut: isOut,
      status: log.status,
      activeBreak: activeBreak || null,
      todayLog: log,
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
      return res.json({ success: true, message: "Already punched in! Have a productive shift! ✨", log });
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

// ── 6. ADMIN DAILY TEAM LEADERBOARD & LIVE STATUS (ACTIVE STAFF ONLY) ──
router.get("/team-overview", protect, async (req, res) => {
  try {
    const today = req.query.date || getTodayStr();

    // Fetch active users, active staff, inactive staff, and today logs
    const [allUsers, activeStaff, inactiveStaff, logsToday] = await Promise.all([
      User.find({ status: "active" }).select("name email role position avatar").lean(),
      Staff.find({ status: "active" }).select("email name position").lean(),
      Staff.find({ status: "inactive" }).select("email name").lean(),
      StaffTimeLog.find({ date: today }).lean(),
    ]);

    const activeEmails = new Set(activeStaff.map((s) => (s.email || "").toLowerCase().trim()).filter(Boolean));
    const activeNames = new Set(activeStaff.map((s) => (s.name || "").toLowerCase().trim()).filter(Boolean));
    const inactiveEmails = new Set(inactiveStaff.map((s) => (s.email || "").toLowerCase().trim()).filter(Boolean));
    const inactiveNames = new Set(inactiveStaff.map((s) => (s.name || "").toLowerCase().trim()).filter(Boolean));

    // Filter users: active staff & admins stay active; only exclude truly inactive staff
    const activeUsers = allUsers.filter((u) => {
      const email = (u.email || "").toLowerCase().trim();
      const name = (u.name || "").toLowerCase().trim();
      if (u.role === "admin" || email === "admin@socialflipss.com" || email === "vivek@gmail.com") {
        return true;
      }
      if (activeEmails.has(email) || activeNames.has(name)) {
        return true;
      }
      if (inactiveEmails.has(email) || inactiveNames.has(name)) {
        return false;
      }
      return true;
    });

    // Deduplicate accounts with identical person name
    const seenNames = new Map();
    activeUsers.forEach((u) => {
      const normName = u.name.toLowerCase().replace(/\s+/g, " ").trim();
      if (!seenNames.has(normName)) {
        seenNames.set(normName, u);
      } else {
        const existing = seenNames.get(normName);
        if (
          (u.role === "shooter" || u.role === "editor" || u.role === "manager") &&
          existing.role === "team"
        ) {
          seenNames.set(normName, u);
        }
      }
    });

    const dedupedUsers = Array.from(seenNames.values());

    // Sort: Admin/Owner first, then alphabetical
    dedupedUsers.sort((a, b) => {
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (b.role === "admin" && a.role !== "admin") return 1;
      return a.name.localeCompare(b.name);
    });

    const logMap = {};
    logsToday.forEach((l) => {
      logMap[l.user.toString()] = l;
    });

    const teamOverview = dedupedUsers.map((u) => {
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
    console.error("GET /team-overview error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/staff-history/:userId", protect, async (req, res) => {
  try {
    const { userId } = req.params;
    const { month } = req.query; // e.g. "2026-09"

    const staffUser = await User.findById(userId).select("name email role position avatar status");
    if (!staffUser) {
      return res.status(404).json({ success: false, message: "Staff user not found" });
    }

    const filter = { user: userId };
    if (month && month !== "all") {
      filter.date = { $regex: `^${month}` };
    }

    const logs = await StaffTimeLog.find(filter).sort({ date: -1 }).lean();

    // Calculate monthly summary
    let totalWorkMinutes = 0;
    let totalBreakMinutes = 0;
    let totalReelsEdited = 0;
    let totalShootsDone = 0;
    let daysPresent = logs.length;

    logs.forEach((log) => {
      totalWorkMinutes += log.totalWorkMinutes || 0;
      totalBreakMinutes += log.totalBreakMinutes || 0;
      totalReelsEdited += log.reelsEditedCount || 0;
      totalShootsDone += log.shootsCompletedCount || 0;
    });

    const summary = {
      daysPresent,
      totalWorkHours: Number((totalWorkMinutes / 60).toFixed(1)),
      totalBreakHours: Number((totalBreakMinutes / 60).toFixed(1)),
      avgDailyWorkHours: daysPresent > 0 ? Number((totalWorkMinutes / (60 * daysPresent)).toFixed(1)) : 0,
      totalReelsEdited,
      totalShootsDone,
    };

    res.json({
      success: true,
      staff: staffUser,
      month: month || "all",
      summary,
      logs,
    });
  } catch (err) {
    console.error("GET /staff-history/:userId error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 7. GET CURRENT USER DATE-WISE HISTORY (Past 30 Days or Month) ──
router.get("/my-history", protect, async (req, res) => {
  try {
    const { month, limit } = req.query; // month in "YYYY-MM" format
    const filter = { user: req.user._id };

    if (month) {
      filter.date = { $regex: `^${month}` };
    }

    const history = await StaffTimeLog.find(filter)
      .sort({ date: -1 })
      .limit(Number(limit) || 31)
      .lean();

    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
