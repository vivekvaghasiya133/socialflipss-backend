const express = require("express");
const router  = express.Router();
const ProductionTask = require("../models/ProductionTask");
const StaffTimeLog   = require("../models/StaffTimeLog");
const Client         = require("../models/Client");
const { protect }    = require("../middleware/auth");

// ── 1. GET ALL TASKS / FILTERED PIPELINE ──
router.get("/tasks", protect, async (req, res) => {
  try {
    const { clientId, stage, roleFilter, search } = req.query;
    const filter = {};

    if (clientId) filter.client = clientId;
    if (stage && stage !== "all") filter.stage = stage;

    // Role-specific view
    if (roleFilter === "my_edits") {
      filter.editor = req.user._id;
    } else if (roleFilter === "my_shoots") {
      filter.shooter = req.user._id;
    } else if (roleFilter === "my_scripts") {
      filter.writer = req.user._id;
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
        { concept: { $regex: search, $options: "i" } },
      ];
    }

    const tasks = await ProductionTask.find(filter)
      .populate("client", "businessName ownerName mobile package")
      .populate("writer", "name avatar")
      .populate("shooter", "name avatar")
      .populate("editor", "name avatar")
      .sort({ updatedAt: -1 })
      .limit(200);

    res.json({ success: true, tasks });
  } catch (err) {
    console.error("GET /tasks error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 2. GET PIPELINE OVERVIEW & CLIENT QUOTAS ──
router.get("/overview", protect, async (req, res) => {
  try {
    const [tasksByStage, clients] = await Promise.all([
      ProductionTask.aggregate([
        { $group: { _id: "$stage", count: { $sum: 1 } } }
      ]),
      Client.find({ status: "active" }).select("businessName package").lean()
    ]);

    const stageCounts = {
      script: 0,
      shoot: 0,
      edit: 0,
      qc: 0,
      completed: 0,
    };

    tasksByStage.forEach(item => {
      if (stageCounts[item._id] !== undefined) {
        stageCounts[item._id] = item.count;
      }
    });

    // Calculate Client Quota Deliveries
    const clientDeliveries = await ProductionTask.aggregate([
      { $match: { stage: "completed" } },
      { $group: { _id: "$client", deliveredCount: { $sum: 1 } } }
    ]);

    const deliveryMap = {};
    clientDeliveries.forEach(d => {
      deliveryMap[d._id.toString()] = d.deliveredCount;
    });

    const clientQuotas = clients.map(c => {
      const reelsQuota = c.package?.deliverables?.find(d => /reel/i.test(d.type || ""))?.quantity || 30;
      const delivered = deliveryMap[c._id.toString()] || 0;
      return {
        _id: c._id,
        businessName: c.businessName,
        packageName: c.package?.name || "Custom Retainer",
        quota: reelsQuota,
        delivered,
        percentage: Math.min(100, Math.round((delivered / reelsQuota) * 100)),
      };
    });

    res.json({
      success: true,
      stageCounts,
      clientQuotas,
    });
  } catch (err) {
    console.error("GET /overview error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 3. CREATE PRODUCTION TASK / REEL ──
router.post("/tasks", protect, async (req, res) => {
  try {
    const { client, title, goal, priority, servicePackage, reelNumber } = req.body;
    if (!client || !title) {
      return res.status(400).json({ success: false, message: "Client and Title are required." });
    }

    const task = new ProductionTask({
      client,
      title,
      goal: goal || "Authority",
      priority: priority || "medium",
      servicePackage: servicePackage || "",
      reelNumber: reelNumber || 1,
      createdBy: req.user._id,
      stage: "script",
    });

    await task.save();
    const populated = await ProductionTask.findById(task._id)
      .populate("client", "businessName mobile")
      .populate("writer", "name")
      .populate("shooter", "name")
      .populate("editor", "name");

    res.json({ success: true, task: populated });
  } catch (err) {
    console.error("POST /tasks error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. STAGE 1: SCRIPT / CONCEPT UPDATE ──
router.put("/tasks/:id/script", protect, async (req, res) => {
  try {
    const { writer, concept, hook, bodyText, cta, scriptStatus, scriptNotes, passToShoot } = req.body;
    const task = await ProductionTask.findById(req.id || req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    if (writer !== undefined) task.writer = writer;
    if (concept !== undefined) task.concept = concept;
    if (hook !== undefined) task.hook = hook;
    if (bodyText !== undefined) task.bodyText = bodyText;
    if (cta !== undefined) task.cta = cta;
    if (scriptNotes !== undefined) task.scriptNotes = scriptNotes;
    if (scriptStatus !== undefined) task.scriptStatus = scriptStatus;

    if (passToShoot || scriptStatus === "approved") {
      task.scriptStatus = "approved";
      task.scriptApprovedAt = new Date();
      task.stage = "shoot";
    }

    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 5. STAGE 2: SHOOT LOGGING & RAW FOOTAGE HANDOFF (Matches WhatsApp flow) ──
router.put("/tasks/:id/shoot", protect, async (req, res) => {
  try {
    const {
      shooter, shootDate, shootTime, location,
      targetReels, completedReels, rawFootageLink,
      shootNote, shootStatus, handoverToEdit
    } = req.body;

    const task = await ProductionTask.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    if (shooter !== undefined) task.shooter = shooter;
    if (shootDate !== undefined) task.shootDate = shootDate;
    if (shootTime !== undefined) task.shootTime = shootTime;
    if (location !== undefined) task.location = location;
    if (targetReels !== undefined) task.targetReels = targetReels;
    if (completedReels !== undefined) task.completedReels = completedReels;
    if (rawFootageLink !== undefined) task.rawFootageLink = rawFootageLink;
    if (shootNote !== undefined) task.shootNote = shootNote;
    if (shootStatus !== undefined) task.shootStatus = shootStatus;

    if (handoverToEdit || (rawFootageLink && completedReels > 0)) {
      task.shootStatus = "done";
      task.shootCompletedAt = new Date();
      task.stage = "edit";
      task.editingStatus = "assigned";
    }

    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 6. STAGE 3: ASSIGN EDITOR ──
router.put("/tasks/:id/assign-editor", protect, async (req, res) => {
  try {
    const { editor, editorDeadline, editorNotes } = req.body;
    const task = await ProductionTask.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    task.editor = editor;
    task.editorAssignedAt = new Date();
    if (editorDeadline) task.editorDeadline = new Date(editorDeadline);
    if (editorNotes) task.editorNotes = editorNotes;
    task.editingStatus = "in_progress";
    task.stage = "edit";

    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 7. STAGE 3: EDITOR SUBMITS & AUTOMATIC REELS SCORE INCREMENT ──
router.put("/tasks/:id/complete-edit", protect, async (req, res) => {
  try {
    const { editedPreviewLink, editorNotes } = req.body;
    const task = await ProductionTask.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    task.editedPreviewLink = editedPreviewLink || task.editedPreviewLink;
    task.editorNotes = editorNotes || task.editorNotes;
    task.editingStatus = "completed";
    task.editingCompletedAt = new Date();
    task.stage = "qc";

    await task.save();

    // 🏆 Gamified Productivity Auto-Credit:
    // Automatically increment the Editor's Daily Score in StaffTimeLog!
    const editorId = task.editor || req.user._id;
    const todayStr = new Date().toISOString().split("T")[0];

    await StaffTimeLog.findOneAndUpdate(
      { user: editorId, date: todayStr },
      { $inc: { reelsEditedCount: 1 } },
      { upsert: false }
    );

    res.json({
      success: true,
      message: "Reel editing marked completed! Score credited to editor. 🎉",
      task,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 8. STAGE 4: CLIENT DELIVERY & MILESTONE UPDATE ──
router.put("/tasks/:id/deliver", protect, async (req, res) => {
  try {
    const { instagramUrl, clientNotes } = req.body;
    const task = await ProductionTask.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    task.isDelivered = true;
    task.deliveredAt = new Date();
    task.stage = "completed";
    if (instagramUrl) task.instagramUrl = instagramUrl;
    if (clientNotes) task.clientNotes = clientNotes;

    await task.save();
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 9. DELETE TASK ──
router.delete("/tasks/:id", protect, async (req, res) => {
  try {
    await ProductionTask.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Task deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
