const express = require("express");
const jwt     = require("jsonwebtoken");
const User    = require("../models/User");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password required" });

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Re-attach comparePassword (since toJSON removes password)
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    if (user.status === "inactive")
      return res.status(403).json({ message: "Account deactivated. Contact admin." });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role, position: user.position },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET /api/auth/me
router.get("/me", protect, (req, res) => res.json(req.user));

// PUT /api/auth/change-password
router.put("/change-password", protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id).select("+password");
    const ok   = await user.comparePassword(currentPassword);
    if (!ok) return res.status(400).json({ message: "Current password incorrect" });
    user.password = newPassword;
    await user.save();
    res.json({ message: "Password changed" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── User management (admin only) ──────────────────────────────────

// GET /api/auth/users — list all users
router.get("/users", protect, authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/auth/users — create manager/team user
router.post("/users", protect, authorize("admin"), async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/auth/users/:id — update user
router.put("/users/:id", protect, authorize("admin"), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (req.body.name) user.name = req.body.name;
    if (req.body.email) user.email = req.body.email.toLowerCase();
    if (req.body.role) user.role = req.body.role;
    if (req.body.position !== undefined) user.position = req.body.position;
    if (req.body.mobile !== undefined) user.mobile = req.body.mobile;
    if (req.body.status) user.status = req.body.status;
    if (req.body.password) user.password = req.body.password;

    await user.save();
    res.json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/auth/users/:id — deactivate
router.delete("/users/:id", protect, authorize("admin"), async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { status: "inactive" });
    res.json({ message: "User deactivated" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
