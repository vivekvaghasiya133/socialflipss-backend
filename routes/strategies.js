const express = require("express");
const Strategy = require("../models/Strategy");
const Client = require("../models/Client");
const Project = require("../models/Project");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// Helper to normalize reelTopics for backward compatibility (in case they are simple strings in DB)
function normalizeStrategy(strat) {
  if (!strat) return null;
  const doc = strat.toObject ? strat.toObject() : strat;
  if (doc.reelTopics && doc.reelTopics.length) {
    doc.reelTopics = doc.reelTopics.map((topic) => {
      if (typeof topic === "string") {
        return { title: topic, brief: "", status: "Draft", feedback: "", contentId: null };
      }
      return topic;
    });
  }
  return doc;
}

// GET /api/strategies - list with filters
router.get("/", async (req, res) => {
  try {
    const { clientId, status, month } = req.query;
    const filter = {};
    if (clientId) filter.clientId = clientId;
    if (status)   filter.status   = status;
    if (month)    filter.month    = month;

    const strategies = await Strategy.find(filter)
      .populate("clientId", "businessName ownerName")
      .populate("strategist", "name")
      .sort({ createdAt: -1 });

    const processed = strategies.map(normalizeStrategy);
    res.json(processed);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET /api/strategies/:id
router.get("/:id", async (req, res) => {
  try {
    const strategy = await Strategy.findById(req.params.id)
      .populate("clientId", "businessName ownerName")
      .populate("strategist", "name");
    if (!strategy) return res.status(404).json({ message: "Strategy not found" });
    res.json(normalizeStrategy(strategy));
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/strategies
router.post("/", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const strategist = req.body.strategist || req.user._id;
    if (!req.body.reelTopics || !req.body.reelTopics.length) {
      const client = await Client.findById(req.body.clientId);
      let targetCount = 15; // default fallback
      if (client && client.package && client.package.deliverables) {
        const reelDeliverable = client.package.deliverables.find(d =>
          d.type && d.type.toLowerCase().includes("reel")
        );
        if (reelDeliverable && reelDeliverable.quantity > 0) {
          targetCount = reelDeliverable.quantity;
        }
      }
      req.body.reelTopics = Array(targetCount).fill(null).map(() => ({
        title: "", brief: "", status: "Draft", feedback: "", contentId: null
      }));
    } else {
      req.body.reelTopics = req.body.reelTopics.map(item => {
        if (typeof item === "string") {
          return { title: item, brief: "", status: "Draft", feedback: "", contentId: null };
        }
        return item;
      });
    }

    const strategy = await Strategy.create({ ...req.body, strategist });

    // Auto-create project for the strategy's client & month
    let project = await Project.findOne({ clientId: strategy.clientId, month: strategy.month });
    if (!project) {
      const client = await Client.findById(strategy.clientId);
      const clientName = client ? client.businessName : "Client";
      await Project.create({
        clientId: strategy.clientId,
        name: `${clientName} - ${strategy.month} Plan`,
        month: strategy.month,
        status: "active",
        createdBy: strategist,
      });
    }

    const populated = await strategy.populate(["clientId", "strategist"]);
    res.status(201).json(normalizeStrategy(populated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/strategies/:id
router.put("/:id", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    if (req.body.reelTopics && req.body.reelTopics.length) {
      req.body.reelTopics = req.body.reelTopics.map(item => {
        if (typeof item === "string") {
          return { title: item, brief: "", status: "Draft", feedback: "", contentId: null };
        }
        return item;
      });
    }
    const strategy = await Strategy.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate("clientId", "businessName ownerName")
      .populate("strategist", "name");
    if (!strategy) return res.status(404).json({ message: "Not found" });

    // Auto-create project for the strategy's client & month
    let project = await Project.findOne({ clientId: strategy.clientId?._id || strategy.clientId, month: strategy.month });
    if (!project) {
      const clientName = strategy.clientId?.businessName || "Client";
      await Project.create({
        clientId: strategy.clientId?._id || strategy.clientId,
        name: `${clientName} - ${strategy.month} Plan`,
        month: strategy.month,
        status: "active",
        createdBy: strategy.strategist?._id || strategy.strategist,
      });
    }

    res.json(normalizeStrategy(strategy));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/strategies/:id
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const strategy = await Strategy.findByIdAndDelete(req.params.id);
    if (!strategy) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Strategy deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
