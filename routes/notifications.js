const express      = require("express");
const Notification = require("../models/Notification");
const { protect }  = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/notifications — admin notifications
router.get("/", async (req, res) => {
  try {
    const { read, limit=30 } = req.query;
    const filter = { recipientType:"admin", recipientId: req.user._id };
    if (read !== undefined) filter.read = read === "true";

    const notifs = await Notification.find(filter)
      .sort({ createdAt:-1 })
      .limit(Number(limit));

    const unread = await Notification.countDocuments({ recipientType:"admin", recipientId:req.user._id, read:false });
    res.json({ notifications: notifs, unread });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// PUT /api/notifications/:id/read
router.put("/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read:true, readAt:new Date() });
    res.json({ message:"Read" });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

// PUT /api/notifications/read-all
router.put("/read-all", async (req, res) => {
  try {
    await Notification.updateMany({ recipientType:"admin", recipientId:req.user._id, read:false }, { read:true, readAt:new Date() });
    res.json({ message:"All read" });
  } catch (err) {
    res.status(500).json({ message:"Server error" });
  }
});

module.exports = router;
