const express = require("express");
const Strategy = require("../models/Strategy");
const Client = require("../models/Client");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

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

    res.json(strategies);
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
    res.json(strategy);
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
      req.body.reelTopics = Array(targetCount).fill("");
    }
    const strategy = await Strategy.create({ ...req.body, strategist });
    const populated = await strategy.populate(["clientId", "strategist"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/strategies/:id
router.put("/:id", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const strategy = await Strategy.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate("clientId", "businessName ownerName")
      .populate("strategist", "name");
    if (!strategy) return res.status(404).json({ message: "Not found" });
    res.json(strategy);
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
