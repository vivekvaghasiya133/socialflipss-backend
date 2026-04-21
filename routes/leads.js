const express = require("express");
const Lead    = require("../models/Lead");
const Client  = require("../models/Client");
const User    = require("../models/User");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/leads/stats
router.get("/stats", async (req, res) => {
  try {
    const total         = await Lead.countDocuments();
    const newLeads      = await Lead.countDocuments({ status: "new" });
    const followUp      = await Lead.countDocuments({ status: "follow_up" });
    const converted     = await Lead.countDocuments({ status: "converted" });
    const notInterested = await Lead.countDocuments({ status: "not_interested" });
    const today = new Date(); today.setHours(23,59,59,999);
    const dueTodayOrOverdue = await Lead.countDocuments({
      nextFollowUp: { $lte: today },
      status: { $in: ["new","follow_up"] },
    });
    const bySource = await Lead.aggregate([
      { $group: { _id:"$source", count:{ $sum:1 } } },
      { $sort:  { count:-1 } },
    ]);
    const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000);
    const recentLeads   = await Lead.countDocuments({ createdAt:{ $gte: thirtyDaysAgo } });
    res.json({ total, newLeads, followUp, converted, notInterested, dueTodayOrOverdue, bySource, recentLeads });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/leads
router.get("/", async (req, res) => {
  try {
    const { status, source, assignedTo, search, page=1, limit=20, dueSoon } = req.query;
    const filter = {};
    if (status)     filter.status     = status;
    if (source)     filter.source     = source;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (req.user.role === "team") filter.assignedTo = req.user._id;
    if (search) {
      filter.$or = [
        { businessName: { $regex:search, $options:"i" } },
        { contactName:  { $regex:search, $options:"i" } },
        { mobile:       { $regex:search, $options:"i" } },
      ];
    }
    if (dueSoon === "true") {
      const today = new Date(); today.setHours(23,59,59,999);
      filter.nextFollowUp = { $lte: today };
      filter.status       = { $in:["new","follow_up"] };
    }
    const total = await Lead.countDocuments(filter);
    const leads = await Lead.find(filter)
      .populate("assignedTo", "name role")
      .populate("createdBy",  "name")
      .sort({ createdAt:-1 })
      .skip((page-1)*limit).limit(Number(limit))
      .select("-activities");
    res.json({ leads, total, page:Number(page), pages:Math.ceil(total/limit) });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/leads/:id
router.get("/:id", async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate("assignedTo", "name role position")
      .populate("createdBy",  "name")
      .populate("activities.addedBy", "name")
      .populate("convertedToClient", "businessName status");
    if (!lead) return res.status(404).json({ message:"Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/leads
router.post("/", authorize("admin","manager"), async (req, res) => {
  try {
    const data = { ...req.body, createdBy: req.user._id };

    // ❌ old
    // if (!data.assignedTo) delete data.assignedTo;

    // ✅ STRONG FIX
    if (data.assignedTo === "" || data.assignedTo === null) {
      delete data.assignedTo;
    }

    const lead = await Lead.create(data);
    res.status(201).json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/leads/:id
router.put("/:id", authorize("admin","manager"), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, { new:true, runValidators:true })
      .populate("assignedTo","name role");
    if (!lead) return res.status(404).json({ message:"Lead not found" });
    res.json(lead);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── NEW: POST /api/leads/:id/convert ─────────────────────────────────────────
// Converts lead to client automatically:
//   1. Creates Client record from lead data
//   2. Marks lead as "converted"
//   3. Returns client with onboarding form link (using client._id as token)
router.post("/:id/convert", authorize("admin","manager"), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message:"Lead not found" });
    if (lead.status === "converted")
      return res.status(400).json({ message:"Lead already converted" });

    // Create client from lead data
    const { packageName, packageAmount } = req.body;
    const client = await Client.create({
      businessName:  lead.businessName,
      ownerName:     lead.contactName,
      mobile:        lead.mobile,
      email:         lead.email    || "",
      city:          lead.city     || "",
      industry:      lead.industry || "",
      notes:         lead.notes    || "",
      leadId:        lead._id,
      assignedTo:    lead.assignedTo || null,
      createdBy:     req.user._id,
      status:        "onboarding",
      onboardingDate:new Date(),
      package: {
        name:   packageName   || "",
        amount: packageAmount || 0,
      },
    });

    // Mark lead as converted
    lead.status            = "converted";
    lead.convertedToClient = client._id;
    await lead.save();

    // Build onboarding form link (frontend URL + client ID as token)
    const frontendUrl       = process.env.FRONTEND_URL || "http://localhost:3000";
    const onboardingFormLink = `${frontendUrl}/onboard-client/${client._id}`;

    res.status(201).json({
      message: "Lead converted to client successfully!",
      client,
      onboardingFormLink,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/leads/:id/activity
router.post("/:id/activity", async (req, res) => {
  try {
    const { type, note, date } = req.body;
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message:"Lead not found" });
    lead.activities.push({ type, note, date: date || new Date(), addedBy: req.user._id });
    lead.lastCommunication = note;
    lead.lastContactDate   = date || new Date();
    await lead.save();
    const updated = await Lead.findById(req.params.id).populate("activities.addedBy","name");
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/leads/:id/activity/:actId
router.delete("/:id/activity/:actId", authorize("admin","manager"), async (req, res) => {
  try {
    await Lead.findByIdAndUpdate(req.params.id, { $pull:{ activities:{ _id: req.params.actId } } });
    res.json({ message:"Deleted" });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// DELETE /api/leads/:id
router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ message:"Lead deleted" });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

module.exports = router;
