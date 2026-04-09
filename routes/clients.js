const express = require("express");
const Client = require("../models/Client");
const protect = require("../middleware/auth");

const router = express.Router();

// ── PUBLIC ──────────────────────────────────────────────
// POST /api/clients/submit — client fills form (no auth needed)
router.post("/submit", async (req, res) => {
  try {
    const client = await Client.create(req.body);
    res.status(201).json({ message: "Form submitted successfully!", id: client._id });
  } catch (err) {
    res.status(400).json({ message: "Submission failed", error: err.message });
  }
});

// ── PROTECTED (admin only) ───────────────────────────────

// GET /api/clients — get all clients with filters & pagination
router.get("/", protect, async (req, res) => {
  try {
    const { status, industry, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (industry) filter.industry = industry;
    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options: "i" } },
        { ownerName:    { $regex: search, $options: "i" } },
        { mobile:       { $regex: search, $options: "i" } },
        { city:         { $regex: search, $options: "i" } },
      ];
    }

    const total = await Client.countDocuments(filter);
    const clients = await Client.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select("businessName ownerName mobile city industry status budget createdAt onboardingDate assignedTo");

    res.json({ clients, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET /api/clients/stats — dashboard stats
router.get("/stats", protect, async (req, res) => {
  try {
    const total      = await Client.countDocuments();
    const newClients = await Client.countDocuments({ status: "new" });
    const active     = await Client.countDocuments({ status: "active" });
    const inProgress = await Client.countDocuments({ status: "in_progress" });

    // Clients per industry
    const byIndustry = await Client.aggregate([
      { $group: { _id: "$industry", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // Last 7 days signups
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentSignups = await Client.countDocuments({ createdAt: { $gte: sevenDaysAgo } });

    // Monthly trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyTrend = await Client.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    res.json({ total, newClients, active, inProgress, byIndustry, recentSignups, monthlyTrend });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET /api/clients/:id — single client full details
router.get("/:id", protect, async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/clients/:id — update client (status, notes, assignedTo etc.)
router.put("/:id", protect, async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, {
      new: true, runValidators: true,
    });
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  } catch (err) {
    res.status(400).json({ message: "Update failed", error: err.message });
  }
});

// DELETE /api/clients/:id
router.delete("/:id", protect, async (req, res) => {
  try {
    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json({ message: "Client deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
