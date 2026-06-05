// const express       = require("express");
// const ShootSchedule = require("../models/ShootSchedule");
// const Content       = require("../models/Content");
// const Client        = require("../models/Client");
// const { protect, authorize } = require("../middleware/auth");

// const router = express.Router();
// router.use(protect);

// // ── SCHEDULER ALGORITHM ───────────────────────────────────────────────────────
// // Rules:
// //  - Skip Sundays (day 0) — Mon to Sat only
// //  - Distribute reels evenly across available days
// //  - Auto-assign time slots: morning → afternoon → evening → next day morning...
// //  - If reels > available slots, increase maxPerDay automatically
// //  - Never exceed date range
// //
// // Time slot display times:
// const SLOT_TIMES = {
//   morning:   "10:00 AM",
//   afternoon: "2:00 PM",
//   evening:   "5:00 PM",
// };

// function generateSchedule({ totalReels, startDate, endDate, workDays = [1,2,3,4,5,6] }) {
//   const start = new Date(startDate + "T00:00:00");
//   const end   = new Date(endDate   + "T00:00:00");

//   // Collect all valid working days between start and end
//   const validDays = [];
//   const cursor = new Date(start);
//   while (cursor <= end) {
//     const dow = cursor.getDay(); // 0=Sun,6=Sat
//     if (workDays.includes(dow)) {
//       validDays.push(cursor.toISOString().slice(0,10));
//     }
//     cursor.setDate(cursor.getDate() + 1);
//   }

//   if (!validDays.length) return [];

//   // Calculate smart maxPerDay — spread evenly, minimum 1
//   let maxPerDay = Math.ceil(totalReels / validDays.length);
//   if (maxPerDay < 1) maxPerDay = 1;

//   const slots   = [];
//   let remaining = totalReels;
//   const slotOrder = ["morning","afternoon","evening"];

//   for (const date of validDays) {
//     if (remaining <= 0) break;

//     // How many reels on this day?
//     const reelsToday = Math.min(maxPerDay, remaining);
//     remaining -= reelsToday;

//     // Distribute into time slots
//     for (let i = 0; i < reelsToday; i++) {
//       const timeSlot = slotOrder[i % slotOrder.length];
//       // Check if slot already exists for this day
//       const existing = slots.find(s => s.date === date && s.timeSlot === timeSlot);
//       if (existing) {
//         existing.reelCount += 1;
//       } else {
//         slots.push({
//           date,
//           timeSlot,
//           time:      SLOT_TIMES[timeSlot],
//           reelCount: 1,
//           status:    "scheduled",
//           note:      "",
//           whatsappSent: false,
//         });
//       }
//     }
//   }

//   // If still remaining (date range too short), add to last available day
//   if (remaining > 0) {
//     const lastDate = validDays[validDays.length - 1];
//     const lastSlot = slots.filter(s => s.date === lastDate);
//     if (lastSlot.length > 0) {
//       lastSlot[lastSlot.length - 1].reelCount += remaining;
//     }
//   }

//   return slots.sort((a,b) => a.date.localeCompare(b.date));
// }

// // ── ROUTES ────────────────────────────────────────────────────────────────────

// // GET /api/shoot-schedule/project/:projectId
// router.get("/project/:projectId", async (req, res) => {
//   try {
//     const schedule = await ShootSchedule.findOne({ projectId: req.params.projectId })
//       .populate("clientId",  "businessName ownerName mobile")
//       .populate("projectId", "name month")
//       .populate("slots.contentIds", "title type");
//     res.json(schedule || null);
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// });

// // GET /api/shoot-schedule/:id
// router.get("/:id", async (req, res) => {
//   try {
//     const s = await ShootSchedule.findById(req.params.id)
//       .populate("clientId",  "businessName ownerName mobile")
//       .populate("projectId", "name month")
//       .populate("slots.contentIds", "title type");
//     if (!s) return res.status(404).json({ message: "Not found" });
//     res.json(s);
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// });

// // POST /api/shoot-schedule/generate — generate or regenerate schedule
// router.post("/generate", authorize("admin","manager"), async (req, res) => {
//   try {
//     const { projectId, clientId, totalReels, startDate, endDate, workDays, maxPerDayOverride } = req.body;

//     if (!totalReels || !startDate || !endDate)
//       return res.status(400).json({ message: "totalReels, startDate, endDate required" });

//     const wd = workDays || [1,2,3,4,5,6];
//     const slots = generateSchedule({ totalReels, startDate, endDate, workDays: wd });

//     // If admin overrides maxPerDay, regenerate with that constraint
//     let finalSlots = slots;
//     if (maxPerDayOverride) {
//       finalSlots = generateSchedule({ totalReels, startDate, endDate, workDays: wd });
//     }

//     // Upsert — delete old and create new
//     await ShootSchedule.findOneAndDelete({ projectId });

//     const schedule = await ShootSchedule.create({
//       projectId, clientId, totalReels, startDate, endDate,
//       workDays: wd,
//       slots: finalSlots,
//       totalScheduled: finalSlots.reduce((s, sl) => s + sl.reelCount, 0),
//       createdBy: req.user._id,
//     });

//     const populated = await schedule.populate([
//       { path:"clientId",  select:"businessName ownerName mobile" },
//       { path:"projectId", select:"name month" },
//     ]);

//     res.status(201).json(populated);
//   } catch (err) {
//     res.status(400).json({ message: err.message });
//   }
// });

// // PUT /api/shoot-schedule/:id/slot/:slotId — update a slot (status, note, reschedule)
// router.put("/:id/slot/:slotId", async (req, res) => {
//   try {
//     const schedule = await ShootSchedule.findById(req.params.id);
//     if (!schedule) return res.status(404).json({ message: "Schedule not found" });

//     const slot = schedule.slots.id(req.params.slotId);
//     if (!slot) return res.status(404).json({ message: "Slot not found" });

//     const { status, note, date, timeSlot, whatsappSent } = req.body;
//     if (status)       slot.status       = status;
//     if (note !== undefined) slot.note   = note;
//     if (date)         slot.date         = date;
//     if (timeSlot)     slot.timeSlot     = timeSlot;
//     if (timeSlot)     slot.time         = SLOT_TIMES[timeSlot] || slot.time;
//     if (whatsappSent !== undefined) slot.whatsappSent = whatsappSent;

//     // Update done count
//     schedule.totalDone = schedule.slots.filter(s => s.status === "done").length;

//     await schedule.save();
//     const populated = await schedule.populate([
//       { path:"clientId",  select:"businessName ownerName mobile" },
//     ]);
//     res.json(populated);
//   } catch (err) {
//     res.status(400).json({ message: err.message });
//   }
// });

// // DELETE /api/shoot-schedule/:id
// router.delete("/:id", authorize("admin"), async (req, res) => {
//   try {
//     await ShootSchedule.findByIdAndDelete(req.params.id);
//     res.json({ message: "Schedule deleted" });
//   } catch (err) {
//     res.status(500).json({ message: "Server error" });
//   }
// });

// module.exports = router;
const express       = require("express");
const ShootSchedule = require("../models/ShootSchedule");
const Content       = require("../models/Content");
const Client        = require("../models/Client");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

router.use(protect);

// ─────────────────────────────────────────────────────────────
// SLOT TIMES
// ─────────────────────────────────────────────────────────────
const SLOT_TIMES = {
  morning: "10:00 AM",
  afternoon: "2:00 PM",
  evening: "5:00 PM",
};

// ─────────────────────────────────────────────────────────────
// SMART SCHEDULE GENERATOR
// RULE:
// 10 reels => 3 + 3 + 3 + 1
// ONE CLIENT = ONE SLOT ONLY
// ─────────────────────────────────────────────────────────────
function generateSchedule({
  totalReels,
  startDate,
  endDate,
  workDays = [1,2,3,4,5,6],
  minReelsPerShoot = 3,
  occupiedSlots = {},
}) {

  const start = new Date(startDate + "T00:00:00");
  const end   = new Date(endDate   + "T00:00:00");

  // Validation
  if (start > end) {
    throw new Error("Start date must be before end date");
  }

  if (totalReels <= 0) {
    throw new Error("Total reels must be greater than 0");
  }

  // ───────────────────────────────────────────────────────────
  // GET VALID WORKING DAYS
  // ───────────────────────────────────────────────────────────
  const validDays = [];

  const cursor = new Date(start);

  while (cursor <= end) {

    const day = cursor.getDay();

    // Skip Sundays
    if (workDays.includes(day)) {

      validDays.push(
        new Date(cursor).toISOString().slice(0,10)
      );

    }

    cursor.setDate(cursor.getDate() + 1);

  }

  if (!validDays.length) {
    throw new Error("No valid working days found");
  }

  // Pre-calculate shoot counts
  const shoots = [];
  let remaining = totalReels;
  while (remaining > 0) {
    const reelsToday = Math.min(minReelsPerShoot, remaining);
    shoots.push({ reelCount: reelsToday });
    remaining -= reelsToday;
  }

  const slots = [];
  const chosenDates = new Set();

  for (const shoot of shoots) {
    let assigned = false;

    // First Pass: Find a valid day with a completely free slot
    for (const date of validDays) {
      if (chosenDates.has(date)) continue;

      const occupied = occupiedSlots[date] || [];
      let freeSlot = null;
      for (const ts of ["morning", "afternoon", "evening"]) {
        if (!occupied.includes(ts)) {
          freeSlot = ts;
          break;
        }
      }

      if (freeSlot) {
        slots.push({
          date,
          timeSlot: freeSlot,
          time: SLOT_TIMES[freeSlot],
          reelCount: shoot.reelCount,
          status: "scheduled",
          note: "",
          whatsappSent: false,
        });
        chosenDates.add(date);
        assigned = true;
        break;
      }
    }

    // Second Pass: If all slots on all days are occupied, allow overlap but prioritize a new day for this client
    if (!assigned) {
      for (const date of validDays) {
        if (chosenDates.has(date)) continue;

        slots.push({
          date,
          timeSlot: "morning",
          time: SLOT_TIMES.morning,
          reelCount: shoot.reelCount,
          status: "scheduled",
          note: "",
          whatsappSent: false,
        });
        chosenDates.add(date);
        assigned = true;
        break;
      }
    }

    // Third Pass: If there are more shoots than valid days, reuse days for this client
    if (!assigned) {
      const fallbackDate = validDays[slots.length % validDays.length];
      const occupied = occupiedSlots[fallbackDate] || [];
      let freeSlot = null;
      for (const ts of ["morning", "afternoon", "evening"]) {
        if (!occupied.includes(ts)) {
          freeSlot = ts;
          break;
        }
      }
      if (!freeSlot) freeSlot = "morning";

      slots.push({
        date: fallbackDate,
        timeSlot: freeSlot,
        time: SLOT_TIMES[freeSlot],
        reelCount: shoot.reelCount,
        status: "scheduled",
        note: "",
        whatsappSent: false,
      });
    }
  }

  return slots.sort(
    (a,b) => a.date.localeCompare(b.date)
  );

}

// ─────────────────────────────────────────────────────────────
// GET PROJECT SCHEDULE
// ─────────────────────────────────────────────────────────────
router.get("/project/:projectId", async (req, res) => {

  try {

    const schedule = await ShootSchedule.findOne({
      projectId: req.params.projectId
    })
    .populate("clientId", "businessName ownerName mobile")
    .populate("projectId", "name month")
    .populate("slots.contentIds", "title type");

    res.json(schedule || null);

  } catch (err) {

    res.status(500).json({
      message: "Server error"
    });

  }

});

// ─────────────────────────────────────────────────────────────
// GET SINGLE SCHEDULE
// ─────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {

  try {

    const schedule = await ShootSchedule.findById(req.params.id)
      .populate("clientId", "businessName ownerName mobile")
      .populate("projectId", "name month")
      .populate("slots.contentIds", "title type");

    if (!schedule) {

      return res.status(404).json({
        message: "Schedule not found"
      });

    }

    res.json(schedule);

  } catch (err) {

    res.status(500).json({
      message: "Server error"
    });

  }

});

// ─────────────────────────────────────────────────────────────
// GENERATE SCHEDULE
// ─────────────────────────────────────────────────────────────
router.post(
  "/generate",
  authorize("admin", "manager"),
  async (req, res) => {

    try {

      const {
        projectId,
        clientId,
        totalReels,
        startDate,
        endDate,
        workDays,
        minReelsPerShoot,
      } = req.body;

      if (
        !projectId ||
        !clientId ||
        !totalReels ||
        !startDate ||
        !endDate
      ) {

        return res.status(400).json({
          message: "Required fields missing"
        });

      }

      // Fetch all existing schedules except the current one
      const existingSchedules = await ShootSchedule.find({
        projectId: { $ne: projectId }
      });

      // Build occupiedSlots map: date -> array of timeSlots
      const occupiedSlots = {};
      for (const schedule of existingSchedules) {
        if (schedule.slots) {
          for (const slot of schedule.slots) {
            if (slot.status !== "cancelled") {
              if (!occupiedSlots[slot.date]) {
                occupiedSlots[slot.date] = [];
              }
              if (!occupiedSlots[slot.date].includes(slot.timeSlot)) {
                occupiedSlots[slot.date].push(slot.timeSlot);
              }
            }
          }
        }
      }

      const finalSlots = generateSchedule({

        totalReels,

        startDate,

        endDate,

        workDays: workDays || [1,2,3,4,5,6],

        minReelsPerShoot: minReelsPerShoot || 3,

        occupiedSlots,

      });

      // Delete old schedule
      await ShootSchedule.findOneAndDelete({
        projectId
      });

      // Create new schedule
      const schedule = await ShootSchedule.create({

        projectId,

        clientId,

        totalReels,

        startDate,

        endDate,

        workDays: workDays || [1,2,3,4,5,6],

        slots: finalSlots,

        totalScheduled: finalSlots.reduce(
          (sum, slot) => sum + slot.reelCount,
          0
        ),

        createdBy: req.user._id,

      });

      const populated = await schedule.populate([
        {
          path: "clientId",
          select: "businessName ownerName mobile"
        },
        {
          path: "projectId",
          select: "name month"
        }
      ]);

      res.status(201).json(populated);

    } catch (err) {

      res.status(400).json({
        message: err.message
      });

    }

  }
);

// ─────────────────────────────────────────────────────────────
// UPDATE SLOT
// ─────────────────────────────────────────────────────────────
router.put("/:id/slot/:slotId", async (req, res) => {

  try {

    const schedule = await ShootSchedule.findById(req.params.id);

    if (!schedule) {

      return res.status(404).json({
        message: "Schedule not found"
      });

    }

    const slot = schedule.slots.id(req.params.slotId);

    if (!slot) {

      return res.status(404).json({
        message: "Slot not found"
      });

    }

    const {
      status,
      note,
      date,
      timeSlot,
      whatsappSent
    } = req.body;

    if (status) {
      slot.status = status;
    }

    if (note !== undefined) {
      slot.note = note;
    }

    if (date) {
      slot.date = date;
    }

    if (timeSlot) {
      slot.timeSlot = timeSlot;
      slot.time = SLOT_TIMES[timeSlot] || slot.time;
    }

    if (whatsappSent !== undefined) {
      slot.whatsappSent = whatsappSent;
    }

    // Update total done
    schedule.totalDone = schedule.slots.filter(
      s => s.status === "done"
    ).length;

    await schedule.save();

    const populated = await schedule.populate([
      {
        path: "clientId",
        select: "businessName ownerName mobile"
      }
    ]);

    res.json(populated);

  } catch (err) {

    res.status(400).json({
      message: err.message
    });

  }

});

// ─────────────────────────────────────────────────────────────
// DELETE SCHEDULE
// ─────────────────────────────────────────────────────────────
router.delete("/:id", authorize("admin"), async (req, res) => {

  try {

    await ShootSchedule.findByIdAndDelete(req.params.id);

    res.json({
      message: "Schedule deleted"
    });

  } catch (err) {

    res.status(500).json({
      message: "Server error"
    });

  }

});

module.exports = router;