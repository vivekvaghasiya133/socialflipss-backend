const express = require("express");
const fs = require("fs");
const path = require("path");
const Meeting = require("../models/Meeting");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/meetings - list all meetings with optional clientId filter
router.get("/", async (req, res) => {
  try {
    const { clientId } = req.query;
    const filter = {};
    if (clientId) filter.clientId = clientId;

    const meetings = await Meeting.find(filter)
      .populate("clientId", "businessName ownerName")
      .populate("createdBy", "name")
      .sort({ date: -1 });

    res.json(meetings);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/meetings - create a new meeting log
router.post("/", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const { clientId, title, purpose, date, notes, images } = req.body;
    if (!clientId || !title || !purpose || !date) {
      return res.status(400).json({ message: "Client, title, purpose, and date are required." });
    }

    const meeting = await Meeting.create({
      clientId,
      title,
      purpose,
      date,
      notes: notes || "",
      images: images || [],
      createdBy: req.user._id
    });

    const populated = await meeting.populate([
      { path: "clientId", select: "businessName ownerName" },
      { path: "createdBy", select: "name" }
    ]);

    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/meetings/:id - delete a meeting log
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const meeting = await Meeting.findByIdAndDelete(req.params.id);
    if (!meeting) return res.status(404).json({ message: "Meeting log not found" });

    // Optionally delete files from storage
    if (meeting.images && meeting.images.length) {
      meeting.images.forEach(imgUrl => {
        try {
          const filename = imgUrl.split("/uploads/")[1];
          if (filename) {
            const filePath = path.join(__dirname, "../uploads", filename);
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        } catch (e) {
          console.error("Failed to delete image file:", imgUrl, e.message);
        }
      });
    }

    res.json({ message: "Meeting log deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /api/meetings/upload - base64 file uploader
router.post("/upload", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const { image } = req.body; // Expects a data URL string: "data:image/png;base64,..."
    if (!image) {
      return res.status(400).json({ message: "No image payload provided." });
    }

    const matches = image.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ message: "Invalid image format. Base64 data URI expected." });
    }

    const imageBuffer = Buffer.from(matches[2], "base64");
    const extension = matches[1] === "jpeg" ? "jpg" : matches[1];
    
    // Ensure upload directory exists
    const uploadsDir = path.join(__dirname, "../uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filename = `meeting_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, imageBuffer);

    // Return relative URL that will be served statically by express
    const imageUrl = `/uploads/${filename}`;
    res.json({ url: imageUrl });
  } catch (err) {
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
});

module.exports = router;
