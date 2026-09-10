const express = require("express");
const router = express.Router();
const whatsappService = require("../services/whatsappService");
const { protect } = require("../middleware/auth");

// GET /api/whatsapp-bot/status
router.get("/status", protect, (req, res) => {
  try {
    const status = whatsappService.getStatus();
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/whatsapp-bot/connect — trigger QR generation or reconnect
router.post("/connect", protect, async (req, res) => {
  try {
    const result = await whatsappService.connect();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/whatsapp-bot/disconnect — log out
router.post("/disconnect", protect, (req, res) => {
  try {
    whatsappService.clearSession();
    res.json({ success: true, message: "WhatsApp Bot disconnected successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/whatsapp-bot/send-test — send test WhatsApp message
router.post("/send-test", protect, async (req, res) => {
  try {
    const { mobile, text } = req.body;
    if (!mobile) {
      return res.status(400).json({ success: false, message: "Mobile number is required" });
    }

    const testMsg = text || "🚀 *SocialFlipss Agency OS — Test Message*\n\nYour 100% Free WhatsApp notification bot is connected and working perfectly! ✨";
    const result = await whatsappService.sendWhatsAppMessage(mobile, testMsg);

    if (result.success) {
      res.json({
        success: true,
        message: `Test message sent to ${result.phone}! 📱`,
        result,
      });
    } else {
      res.json({
        success: false,
        message: result.error || result.message || "Failed to send auto message",
        waLink: result.waLink,
        result,
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
