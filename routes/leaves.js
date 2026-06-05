const express = require("express");
const Leave   = require("../models/Leave");
const Staff   = require("../models/Staff");
const Attendance = require("../models/Attendance");
const {protect} = require("../middleware/auth");
const { sendLeaveAppliedToAdmin, sendLeaveStatusToStaff } = require("../utils/mailer");

const router = express.Router();

function getDatesInRange(startDateStr, endDateStr) {
  const dates = [];
  const start = new Date(startDateStr + "T00:00:00");
  const end = new Date(endDateStr + "T00:00:00");
  
  let current = new Date(start);
  while (current <= end) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

async function syncAttendanceForLeave(leave) {
  const staffId = leave.staffId._id || leave.staffId;
  const dates = getDatesInRange(leave.fromDate, leave.toDate);

  if (leave.status !== "approved") {
    // If not approved, delete any absent/half_day attendance records for these dates
    await Attendance.deleteMany({
      staffId,
      date: { $in: dates },
      status: { $in: ["absent", "half_day"] }
    });
    return;
  }

  // If approved, upsert attendance records
  // Map full_day to 'absent' so that 1 day is deducted from salary
  const statusToMark = leave.leaveType === "half_day" ? "half_day" : "absent";
  const noteText = `Approved Leave: ${leave.reason}`;

  const ops = dates.map(date => ({
    updateOne: {
      filter: { staffId, date },
      update: { staffId, date, status: statusToMark, note: noteText },
      upsert: true
    }
  }));

  if (ops.length > 0) {
    await Attendance.bulkWrite(ops);
  }
}

// ── PUBLIC ROUTES (staff uses unique token link) ──────────────────

// GET /api/leaves/staff-form/:token — verify token, get staff info
router.get("/staff-form/:token", async (req, res) => {
  try {
    const staff = await Staff.findOne({ leaveToken: req.params.token, status: "active" });
    if (!staff) return res.status(404).json({ message: "Invalid or expired link." });
    res.json({ name: staff.name, position: staff.position, staffId: staff._id });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/leaves/staff-form/:token — staff submits leave (no auth)
router.post("/staff-form/:token", async (req, res) => {
  try {
    const staff = await Staff.findOne({ leaveToken: req.params.token, status: "active" });
    if (!staff) return res.status(404).json({ message: "Invalid or expired link." });

    const { fromDate, toDate, leaveType, reason } = req.body;
    if (!fromDate || !toDate || !reason)
      return res.status(400).json({ message: "fromDate, toDate ane reason required chhe." });

    const leave = await Leave.create({
      staffId: staff._id, fromDate, toDate,
      leaveType: leaveType || "full_day", reason,
    });

    // Email admin — non-blocking
    try {
      await sendLeaveAppliedToAdmin({
        staffName: staff.name, staffPosition: staff.position,
        fromDate, toDate, leaveType: leave.leaveType, reason,
      });
    } catch (mailErr) {
      console.error("Admin email failed:", mailErr.message);
    }

    res.status(201).json({ message: "Leave request submit thayo! Admin approve/reject karashe." });
  } catch (err) {
    res.status(400).json({ message: "Submit failed", error: err.message });
  }
});

// ── PROTECTED ROUTES (admin only) ────────────────────────────────

router.use(protect);

// GET all leave requests
router.get("/", async (req, res) => {
  try {
    const { status, staffId } = req.query;
    const filter = {};
    if (status)  filter.status  = status;
    if (staffId) filter.staffId = staffId;
    const leaves = await Leave.find(filter)
      .populate("staffId", "name position email")
      .sort({ createdAt: -1 });
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST apply leave (admin adds manually)
router.post("/", async (req, res) => {
  try {
    const leave = await Leave.create(req.body);
    const populated = await leave.populate("staffId", "name position email");
    
    // Sync attendance if manually created as approved
    await syncAttendanceForLeave(populated);

    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: "Create failed", error: err.message });
  }
});

// PUT approve / reject — sends email to staff
router.put("/:id", async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const leave = await Leave.findByIdAndUpdate(
      req.params.id,
      { status, adminNote: adminNote || "", emailSent: false },
      { new: true }
    ).populate("staffId", "name position email");

    if (!leave) return res.status(404).json({ message: "Leave not found" });

    // Sync attendance records based on the updated leave status
    await syncAttendanceForLeave(leave);

    // Send email to staff if they have email
    if (leave.staffId?.email && (status === "approved" || status === "rejected")) {
      try {
        await sendLeaveStatusToStaff({
          staffEmail: leave.staffId.email,
          staffName:  leave.staffId.name,
          status,
          fromDate:   leave.fromDate,
          toDate:     leave.toDate,
          adminNote:  adminNote || "",
        });
        await Leave.findByIdAndUpdate(req.params.id, { emailSent: true });
        leave.emailSent = true;
      } catch (mailErr) {
        console.error("Staff email failed:", mailErr.message);
      }
    }

    res.json(leave);
  } catch (err) {
    res.status(400).json({ message: "Update failed" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const leave = await Leave.findById(req.params.id);
    if (leave) {
      // Revert attendance if the leave was approved before deletion
      if (leave.status === "approved") {
        const staffId = leave.staffId._id || leave.staffId;
        const dates = getDatesInRange(leave.fromDate, leave.toDate);
        await Attendance.deleteMany({
          staffId,
          date: { $in: dates },
          status: { $in: ["absent", "half_day"] }
        });
      }
      await leave.deleteOne();
    }
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
