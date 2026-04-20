const express = require("express");
const Client  = require("../models/Client");
const Lead    = require("../models/Lead");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/clients/stats
router.get("/stats", async (req, res) => {
  try {
    const total      = await Client.countDocuments();
    const active     = await Client.countDocuments({ status: "active" });
    const onboarding = await Client.countDocuments({ status: "onboarding" });
    const paused     = await Client.countDocuments({ status: "paused" });
    const churned    = await Client.countDocuments({ status: "churned" });

    // Industry breakdown
    const byIndustry = await Client.aggregate([
      { $group: { _id: "$industry", count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
    ]);

    // Monthly signups last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthlyTrend = await Client.aggregate([
      { $match: { createdAt: { $gte: sixMonthsAgo } } },
      { $group: { _id: { y: { $year:"$createdAt" }, m: { $month:"$createdAt" } }, count: { $sum:1 } } },
      { $sort:  { "_id.y":1, "_id.m":1 } },
    ]);

    res.json({ total, active, onboarding, paused, churned, byIndustry, monthlyTrend });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/clients — list with filters
router.get("/", async (req, res) => {
  try {
    const { status, industry, search, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (industry) filter.industry = industry;
    if (search) {
      filter.$or = [
        { businessName: { $regex: search, $options:"i" } },
        { ownerName:    { $regex: search, $options:"i" } },
        { mobile:       { $regex: search, $options:"i" } },
      ];
    }
    // Team sees only their assigned clients
    if (req.user.role === "team") filter.assignedTo = req.user._id;

    const total   = await Client.countDocuments(filter);
    const clients = await Client.find(filter)
      .populate("assignedTo", "name")
      .populate("createdBy",  "name")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .select("businessName ownerName mobile city industry status package.name package.amount onboardingDate assignedTo createdBy");

    res.json({ clients, total, page: Number(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/clients/submit — public onboarding form (no auth)
router.post("/submit", async (req, res) => {
  try {
    const client = await Client.create({ ...req.body, status: "onboarding" });
    res.status(201).json({ message: "Form submitted!", id: client._id });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /api/clients/:id
router.get("/:id", async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate("assignedTo", "name role")
      .populate("createdBy",  "name")
      .populate("leadId",     "businessName status");
    if (!client) return res.status(404).json({ message: "Client not found" });
    res.json(client);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/clients — create client (admin/manager)
router.post("/", authorize("admin", "manager"), async (req, res) => {
  try {
    const client = await Client.create({ ...req.body, createdBy: req.user._id });

    // If created from lead, mark lead as converted
    if (req.body.leadId) {
      await Lead.findByIdAndUpdate(req.body.leadId, {
        status: "converted",
        convertedToClient: client._id,
      });
    }
    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/clients/:id
router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!client) return res.status(404).json({ message: "Not found" });
    res.json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/clients/:id
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.params.id);
    res.json({ message: "Client deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
