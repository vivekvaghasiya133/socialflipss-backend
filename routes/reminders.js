const express  = require("express");
const Reminder = require("../models/Reminder");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/reminders/stats
router.get("/stats", async (req, res) => {
  try {
    const now   = new Date();
    const today = new Date(now); today.setHours(23,59,59,999);

    const total    = await Reminder.countDocuments({ done: false });
    const overdue  = await Reminder.countDocuments({ done:false, dueDate:{ $lt: new Date() } });
    const dueToday = await Reminder.countDocuments({ done:false, dueDate:{ $lte: today, $gte: new Date(now.setHours(0,0,0,0)) } });
    const done     = await Reminder.countDocuments({ done: true });

    res.json({ total, overdue, dueToday, done });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/reminders
router.get("/", async (req, res) => {
  try {
    const { type, done, dueSoon } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (done !== undefined) filter.done = done === "true";

    if (dueSoon === "true") {
      const today = new Date(); today.setHours(23,59,59,999);
      filter.dueDate = { $lte: today };
      filter.done    = false;
    }

    // Team sees assigned reminders only
    if (req.user.role === "team") filter.assignedTo = req.user._id;

    const reminders = await Reminder.find(filter)
      .populate("leadId",     "businessName contactName mobile")
      .populate("clientId",   "businessName ownerName mobile")
      .populate("invoiceId",  "invoiceNumber totalAmount pendingAmount")
      .populate("assignedTo", "name")
      .populate("createdBy",  "name")
      .sort({ done: 1, dueDate: 1 });

    res.json(reminders);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/reminders
router.post("/", async (req, res) => {
  try {
    const reminder = await Reminder.create({ ...req.body, createdBy: req.user._id });
    const populated = await reminder.populate(["leadId","clientId","assignedTo"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/reminders/:id — update or mark done
router.put("/:id", async (req, res) => {
  try {
    if (req.body.done === true) req.body.doneAt = new Date();
    const reminder = await Reminder.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate(["leadId","clientId","invoiceId","assignedTo"]);
    res.json(reminder);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/reminders/:id
router.delete("/:id", async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
