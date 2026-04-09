const express = require("express");
const Leave   = require("../models/Leave");
const Staff   = require("../models/Staff");
const protect = require("../middleware/auth");
const { sendLeaveAppliedToAdmin, sendLeaveStatusToStaff } = require("../utils/mailer");

const router = express.Router();

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
    await Leave.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
