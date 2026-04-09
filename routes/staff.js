const express = require("express");
const Staff   = require("../models/Staff");
const protect = require("../middleware/auth");
const router  = express.Router();

router.use(protect);

// GET all staff — includes leaveToken for sharing link
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const staff  = await Staff.find(filter).sort({ createdAt: -1 });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ message: "Not found" });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const staff = await Staff.create(req.body);
    res.status(201).json(staff);
  } catch (err) {
    res.status(400).json({ message: "Create failed", error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const staff = await Staff.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!staff) return res.status(404).json({ message: "Not found" });
    res.json(staff);
  } catch (err) {
    res.status(400).json({ message: "Update failed" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await Staff.findByIdAndUpdate(req.params.id, { status: "inactive" });
    res.json({ message: "Staff deactivated" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
