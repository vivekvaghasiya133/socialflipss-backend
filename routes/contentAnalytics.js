const express = require("express");
const ContentAnalytics = require("../models/ContentAnalytics");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/content-analytics
router.get("/", async (req, res) => {
  try {
    const { clientId, contentId } = req.query;
    const filter = {};
    if (clientId)  filter.clientId  = clientId;
    if (contentId) filter.contentId = contentId;

    const analytics = await ContentAnalytics.find(filter)
      .populate("clientId", "businessName ownerName")
      .populate("contentId", "title type stage platform")
      .sort({ createdAt: -1 });

    res.json(analytics);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET /api/content-analytics/:id
router.get("/:id", async (req, res) => {
  try {
    const analytic = await ContentAnalytics.findById(req.params.id)
      .populate("clientId", "businessName ownerName")
      .populate("contentId", "title type stage platform");
    if (!analytic) return res.status(404).json({ message: "Analytics record not found" });
    res.json(analytic);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/content-analytics
router.post("/", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const analytic = await ContentAnalytics.create(req.body);
    const populated = await analytic.populate(["clientId", "contentId"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/content-analytics/:id
router.put("/:id", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const analytic = await ContentAnalytics.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate("clientId", "businessName ownerName")
      .populate("contentId", "title type stage platform");
    if (!analytic) return res.status(404).json({ message: "Not found" });
    res.json(analytic);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/content-analytics/:id
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const analytic = await ContentAnalytics.findByIdAndDelete(req.params.id);
    if (!analytic) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Analytics record deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
