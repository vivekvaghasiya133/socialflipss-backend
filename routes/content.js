const express = require("express");
const Content = require("../models/Content");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(protect);

// GET /api/content/stats?projectId= or clientId=
router.get("/stats", async (req, res) => {
  try {
    const { projectId, clientId, month } = req.query;
    const filter = {};
    if (projectId) filter.projectId = projectId;
    if (clientId) filter.clientId = clientId;

    const [total, idea, script, shoot, edit, qc, clientApproval, posted] = await Promise.all([
      Content.countDocuments(filter),
      Content.countDocuments({ ...filter, stage: "idea" }),
      Content.countDocuments({ ...filter, stage: "script" }),
      Content.countDocuments({ ...filter, stage: "shoot" }),
      Content.countDocuments({ ...filter, stage: "edit" }),
      Content.countDocuments({ ...filter, stage: "qc" }),
      Content.countDocuments({ ...filter, stage: "client_approval" }),
      Content.countDocuments({ ...filter, stage: "posted" }),
    ]);

    // By type breakdown
    const byType = await Content.aggregate([
      { $match: filter },
      { $group: { _id: "$type", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({ total, idea, script, shoot, edit, qc, clientApproval, posted, byType });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/content — list with filters (for kanban and calendar)
router.get("/", async (req, res) => {
  try {
    const { projectId, clientId, stage, assignedTo, type, page = 1, limit = 100 } = req.query;
    const filter = {};
    if (projectId) filter.projectId = projectId;
    if (clientId) filter.clientId = clientId;
    if (stage) filter.stage = stage;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (type) filter.type = type;
    // Allow all team members (including writers and editors) to see the entire content pipeline

    const total = await Content.countDocuments(filter);
    const content = await Content.find(filter)
      .populate("assignedTo", "name")
      .populate("shooterId", "name")
      .populate("editorId", "name")
      .populate("projectId", "name month")
      .populate("clientId", "businessName")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ content, total });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/content/editor-productivity — aggregate month-wise counts of edited videos for each editor
router.get("/editor-productivity", async (req, res) => {
  try {
    const User = require("../models/User");
    const editors = await User.find({ role: { $in: ["team", "admin", "manager", "staff"] } });

    const reels = await Content.find({
      editorId: { $ne: null }
    }).populate("editorId", "name");

    const productivity = editors.map(editor => {
      const editorReels = reels.filter(r => 
        r.editorId && r.editorId._id.toString() === editor._id.toString()
      );
      
      const months = {};
      const days = {};
      let totalRevisions = 0;

      editorReels.forEach(reel => {
        // Count revisions and group them by date
        totalRevisions += (reel.revisionCount || 0);
        if (reel.revisionsList && reel.revisionsList.length > 0) {
          reel.revisionsList.forEach(rev => {
            const revDate = new Date(rev.date);
            if (!isNaN(revDate.getTime())) {
              const yyyy = revDate.getFullYear();
              const mm = String(revDate.getMonth() + 1).padStart(2, '0');
              const dd = String(revDate.getDate()).padStart(2, '0');
              const dayKey = `${yyyy}-${mm}-${dd}`;
              
              if (!days[dayKey]) {
                days[dayKey] = { edits: 0, revisions: [] };
              }
              days[dayKey].revisions.push({
                _id: rev._id,
                reelId: reel._id,
                reelTitle: reel.title,
                feedbackText: rev.feedbackText || "No feedback text comments."
              });
            }
          });
        }

        // Count completed edits
        if (reel.editedAt) {
          const date = new Date(reel.editedAt);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const monthNum = String(date.getMonth() + 1).padStart(2, '0');
            const monthKey = `${year}-${monthNum}`; // e.g. "2026-08"
            months[monthKey] = (months[monthKey] || 0) + 1;

            const dayNum = String(date.getDate()).padStart(2, '0');
            const dayKey = `${year}-${monthNum}-${dayNum}`; // e.g. "2026-08-24"
            
            if (!days[dayKey]) {
              days[dayKey] = { edits: 0, revisions: [] };
            }
            days[dayKey].edits += 1;
          }
        }
      });

      return {
        editor: {
          _id: editor._id,
          name: editor.name,
          role: editor.role
        },
        months,
        days,
        revisions: totalRevisions
      };
    });

    res.json(productivity);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET /api/content/:id
router.get("/:id", async (req, res) => {
  try {
    const content = await Content.findById(req.params.id)
      .populate("assignedTo", "name role")
      .populate("projectId", "name month")
      .populate("clientId", "businessName ownerName")
      .populate("comments.addedBy", "name");
    if (!content) return res.status(404).json({ message: "Not found" });
    res.json(content);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/content
router.post("/", async (req, res) => {
  try {
    if (req.body.clientId && !req.body.projectId) {
      const Project = require("../models/Project");
      const Client = require("../models/Client");
      const client = await Client.findById(req.body.clientId);
      if (client) {
        const now = new Date();
        const year = now.getFullYear();
        const monthNum = String(now.getMonth() + 1).padStart(2, '0');
        const monthString = `${year}-${monthNum}`; // "2026-08"
        const monthLabel = now.toLocaleString("default", { month: "long" }) + " " + year + " Plan";

        let project = await Project.findOne({ clientId: client._id, month: monthString });
        if (!project) {
          project = await Project.create({
            clientId: client._id,
            name: monthLabel,
            month: monthString,
            status: "active",
            startDate: new Date(year, now.getMonth(), 1),
            endDate: new Date(year, now.getMonth() + 1, 0),
            createdBy: req.user._id
          });
        }
        req.body.projectId = project._id;

        // Auto-create a Strategy Vault entry for the client for this month if it doesn't exist
        const Strategy = require("../models/Strategy");
        let strategy = await Strategy.findOne({ clientId: client._id, month: monthString });
        if (!strategy) {
          await Strategy.create({
            clientId: client._id,
            month: monthString,
            strategist: req.user._id,
            status: "Draft",
            notes: "Auto-created from Reels Tracker"
          });
        }
      }
    }

    const item = await Content.create({ ...req.body, createdBy: req.user._id });
    const populated = await item.populate(["assignedTo", "projectId", "clientId"]);
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/content/:id — update any field including stage
router.put("/:id", async (req, res) => {
  try {
    const current = await Content.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Not found" });

    // Transition 1: Shoot -> Edit (When shootDataLink is uploaded/changed)
    if (current.stage === "shoot" && req.body.shootDataLink && req.body.shootDataLink !== current.shootDataLink) {
      req.body.stage = "edit";
    }

    // Transition 2: Edit -> QC (When edited draft driveLink is uploaded/changed)
    if (current.stage === "edit" && req.body.driveLink && req.body.driveLink !== current.driveLink) {
      req.body.stage = "qc";
    }

    // Transition 3: QC Revisions -> Edit & Notify Editor
    let sendQcNotification = false;
    if (current.stage === "qc" && req.body.stage === "edit") {
      sendQcNotification = true;
    }

    // If moving to "posted", set postedAt timestamp
    if (req.body.stage === "posted" && !req.body.postedAt) {
      req.body.postedAt = new Date();
    }

    // Increment revisionCount when moving back to edit stage from QC, Client Approval, Posted, or Approved
    const isMovingToRevision = ["qc", "client_approval", "posted", "approved"].includes(current.stage) && req.body.stage === "edit";
    if (isMovingToRevision) {
      req.body.revisionCount = (current.revisionCount || 0) + 1;
      
      const feedback = req.body.qcFeedbackText || current.qcFeedbackText || "QC revision requested.";
      const newRevision = {
        feedbackText: feedback,
        date: new Date()
      };
      
      const updatedList = [...(current.revisionsList || [])];
      updatedList.push(newRevision);
      req.body.revisionsList = updatedList;
    }

    // Set editedAt when stage transitions to edit or later
    const isEditingCompleted = ["edit", "qc", "client_approval", "posted", "approved"].includes(req.body.stage || current.stage);
    if (isEditingCompleted) {
      if (!current.editedAt) {
        req.body.editedAt = new Date();
      }
    } else if (req.body.stage && !isEditingCompleted) {
      req.body.editedAt = null;
    }

    const item = await Content.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("assignedTo", "name")
      .populate("shooterId", "name")
      .populate("editorId", "name")
      .populate("projectId", "name")
      .populate("clientId", "businessName");

    if (!item) return res.status(404).json({ message: "Not found" });

    // Handle QC notification to editor
    if (sendQcNotification) {
      const editorIdToNotify = item.editorId?._id || item.editorId;
      if (editorIdToNotify) {
        try {
          const { createNotification } = require("../utils/notifier");
          const fbText = item.qcFeedbackText || "No text comments provided.";
          const vnLink = item.qcVoiceNote || "No voice note link provided.";
          await createNotification({
            recipientType: "admin",
            recipientId: editorIdToNotify,
            title: "🎬 QC Changes Requested",
            message: `Head QC ne video "${item.title}" par changes rrequest karya chhe. Note: "${fbText}". Voice Note: ${vnLink}`,
            type: "content_changes_requested",
            link: `/admin/project-kanban/${item.projectId?._id || item.projectId}`,
            clientId: item.clientId?._id || item.clientId,
            contentId: item._id,
          });
        } catch (notifErr) {
          console.error("Failed to dispatch editor notification on QC changes:", notifErr.message);
        }
      }
    }

    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/content/:id/comment — add comment
router.post("/:id/comment", async (req, res) => {
  try {
    const { text } = req.body;
    const item = await Content.findByIdAndUpdate(
      req.params.id,
      { $push: { comments: { text, addedBy: req.user._id } } },
      { new: true }
    ).populate("comments.addedBy", "name");
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/content/:id/comment/:commentId
router.delete("/:id/comment/:commentId", authorize("admin", "manager"), async (req, res) => {
  try {
    await Content.findByIdAndUpdate(req.params.id, {
      $pull: { comments: { _id: req.params.commentId } },
    });
    res.json({ message: "Comment deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// DELETE /api/content/:id
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    await Content.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
