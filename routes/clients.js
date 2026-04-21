const express = require("express");
const Client  = require("../models/Client");
const Lead    = require("../models/Lead");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// ── PUBLIC: Client fills onboarding form via unique link ──────────────────────

// GET /api/clients/onboard/:clientId — verify client exists, return basic info
router.get("/onboard/:clientId", async (req, res) => {
  try {
    const client = await Client.findById(req.params.clientId)
      .select("businessName ownerName mobile status onboardingDate");
    if (!client) return res.status(404).json({ message:"Invalid onboarding link." });
    if (client.status !== "onboarding")
      return res.status(400).json({ message:"Onboarding already completed.", alreadyDone: true });
    res.json({
      name:     client.ownerName,
      business: client.businessName,
      clientId: client._id,
    });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// POST /api/clients/onboard/:clientId — client submits form, updates record
router.post("/onboard/:clientId", async (req, res) => {
  try {
    const client = await Client.findById(req.params.clientId);
    if (!client) return res.status(404).json({ message:"Invalid onboarding link." });

    // Merge onboarding data into existing client record
    const allowedFields = [
      "email","city","industry","website","instagramPage",
      "description","targetAudience","services","competitors","usp",
      "brandColors","tone","contentTypes","platforms","goal",
      "inspirationLink","referral","notes","contactTime","reporting",
      "prevExp","prevProblem","budget","postFrequency","agreed",
    ];

    const updateData = {};
    allowedFields.forEach(f => {
      if (req.body[f] !== undefined) updateData[f] = req.body[f];
    });

    // Mark onboarding done
    updateData.status = "active";

    await Client.findByIdAndUpdate(req.params.clientId, updateData);
    res.json({ message:"Onboarding complete! SocialFlipss team soon contact karshhe. 🙌" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── PROTECTED: Admin client routes ────────────────────────────────────────────

router.use(protect);

// GET /api/clients/stats
router.get("/stats", async (req, res) => {
  try {
    const total      = await Client.countDocuments();
    const active     = await Client.countDocuments({ status:"active" });
    const onboarding = await Client.countDocuments({ status:"onboarding" });
    const paused     = await Client.countDocuments({ status:"paused" });
    const churned    = await Client.countDocuments({ status:"churned" });
    const byIndustry = await Client.aggregate([
      { $group:{ _id:"$industry", count:{ $sum:1 } } },
      { $sort:{ count:-1 } },
    ]);
    const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth()-6);
    const monthlyTrend = await Client.aggregate([
      { $match:{ createdAt:{ $gte: sixMonthsAgo } } },
      { $group:{ _id:{ y:{ $year:"$createdAt" }, m:{ $month:"$createdAt" } }, count:{ $sum:1 } } },
      { $sort:{ "_id.y":1, "_id.m":1 } },
    ]);
    res.json({ total, active, onboarding, paused, churned, byIndustry, monthlyTrend });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// GET /api/clients
router.get("/", async (req, res) => {
  try {
    const { status, industry, search, page=1, limit=20 } = req.query;
    const filter = {};
    if (status)   filter.status   = status;
    if (industry) filter.industry = industry;
    if (search) {
      filter.$or = [
        { businessName:{ $regex:search, $options:"i" } },
        { ownerName:   { $regex:search, $options:"i" } },
        { mobile:      { $regex:search, $options:"i" } },
      ];
    }
    if (req.user.role === "team") filter.assignedTo = req.user._id;
    const total   = await Client.countDocuments(filter);
    const clients = await Client.find(filter)
      .populate("assignedTo","name")
      .populate("createdBy","name")
      .sort({ createdAt:-1 })
      .skip((page-1)*limit).limit(Number(limit))
      .select("businessName ownerName mobile city industry status package.name package.amount onboardingDate assignedTo createdBy");
    res.json({ clients, total, page:Number(page), pages:Math.ceil(total/limit) });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// GET /api/clients/:id
router.get("/:id", async (req, res) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate("assignedTo","name role")
      .populate("createdBy","name")
      .populate("leadId","businessName status");
    if (!client) return res.status(404).json({ message:"Not found" });
    res.json(client);
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// POST /api/clients
router.post("/", authorize("admin","manager"), async (req, res) => {
  try {
    const client = await Client.create({ ...req.body, createdBy: req.user._id });
    if (req.body.leadId) {
      await Lead.findByIdAndUpdate(req.body.leadId, { status:"converted", convertedToClient: client._id });
    }
    res.status(201).json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/clients/:id
router.put("/:id", authorize("admin","manager"), async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new:true, runValidators:true });
    if (!client) return res.status(404).json({ message:"Not found" });
    res.json(client);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/clients/:id
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    await Client.findByIdAndDelete(req.params.id);
    res.json({ message:"Client deleted" });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

module.exports = router;
