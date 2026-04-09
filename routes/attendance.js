const express    = require("express");
const Attendance = require("../models/Attendance");
const Staff      = require("../models/Staff");
const protect    = require("../middleware/auth");
const router     = express.Router();

router.use(protect);

// ── SALARY CALCULATION ────────────────────────────────────────────
// Rules (26 working days base):
//   present  → no deduction
//   holiday  → no deduction  ✅ FIXED: holiday = present, no cut
//   leave    → no deduction (approved leave)
//   half_day → 0.5 day deduction
//   absent   → 1 day deduction
function calcSalary(monthlySalary, records) {
  const perDay = monthlySalary / 26;
  let deductDays = 0;

  records.forEach((r) => {
    if (r.status === "absent")   deductDays += 1;
    if (r.status === "half_day") deductDays += 0.5;
    // present / holiday / leave → 0 deduction
  });

  const deduction = parseFloat((deductDays * perDay).toFixed(2));
  const netSalary = parseFloat((monthlySalary - deduction).toFixed(2));

  return {
    perDay,
    deductDays,
    deduction,
    netSalary,
    present:  records.filter((r) => r.status === "present").length,
    absent:   records.filter((r) => r.status === "absent").length,
    halfDay:  records.filter((r) => r.status === "half_day").length,
    leave:    records.filter((r) => r.status === "leave").length,
    holiday:  records.filter((r) => r.status === "holiday").length,
  };
}

// GET /api/attendance?staffId=&month=YYYY-MM&date=YYYY-MM-DD
router.get("/", async (req, res) => {
  try {
    const { staffId, month, date } = req.query;
    const filter = {};
    if (staffId) filter.staffId = staffId;
    if (date)    filter.date    = date;
    if (month)   filter.date    = { $regex: `^${month}` };

    const records = await Attendance.find(filter)
      .populate("staffId", "name position salary")
      .sort({ date: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/attendance/mark — single staff single day
router.post("/mark", async (req, res) => {
  try {
    const { staffId, date, status, note } = req.body;
    const record = await Attendance.findOneAndUpdate(
      { staffId, date },
      { staffId, date, status, note: note || "" },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(record);
  } catch (err) {
    res.status(400).json({ message: "Mark failed", error: err.message });
  }
});

// POST /api/attendance/bulk-mark — all staff one day
router.post("/bulk-mark", async (req, res) => {
  try {
    const { date, records } = req.body;
    const ops = records.map((r) => ({
      updateOne: {
        filter: { staffId: r.staffId, date },
        update: { staffId: r.staffId, date, status: r.status, note: r.note || "" },
        upsert: true,
      },
    }));
    await Attendance.bulkWrite(ops);
    res.json({ message: `Attendance marked for ${records.length} staff on ${date}` });
  } catch (err) {
    res.status(400).json({ message: "Bulk mark failed", error: err.message });
  }
});

// GET /api/attendance/summary?month=YYYY-MM
router.get("/summary", async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: "month required" });

    const allStaff   = await Staff.find({ status: "active" });
    const allRecords = await Attendance.find({ date: { $regex: `^${month}` } });

    const summary = allStaff.map((s) => {
      const records = allRecords.filter((r) => r.staffId.toString() === s._id.toString());
      return { staffId: s._id, name: s.name, position: s.position, salary: s.salary, ...calcSalary(s.salary, records), totalRecorded: records.length };
    });

    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/attendance/slip/:staffId?month=YYYY-MM
router.get("/slip/:staffId", async (req, res) => {
  try {
    const { month } = req.query;
    const staff   = await Staff.findById(req.params.staffId);
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    const records = await Attendance.find({
      staffId: req.params.staffId,
      date:    { $regex: `^${month}` },
    }).sort({ date: 1 });

    res.json({
      staff:   { name: staff.name, position: staff.position, joiningDate: staff.joiningDate, salary: staff.salary },
      month,
      records,
      ...calcSalary(staff.salary, records),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
