const express = require("express");
const router  = express.Router();
const ProductionTask = require("../models/ProductionTask");
const StaffTimeLog   = require("../models/StaffTimeLog");
const Client         = require("../models/Client");
const Notification   = require("../models/Notification");
const { protect }    = require("../middleware/auth");

// Helper to create notifications
const sendInAppNotification = async ({ recipientId, title, message, link, clientId }) => {
  try {
    if (!recipientId) return;
    await Notification.create({
      recipientType: "admin",
      recipientId,
      title,
      message,
      link: link || "/admin/production-hub",
      clientId: clientId || null,
    });
  } catch (err) {
    console.warn("Notification creation warning:", err.message);
  }
};

// ── 1. GET ALL TASKS / FILTERED PIPELINE ──
router.get("/tasks", protect, async (req, res) => {
  try {
    const { clientId, stage, roleFilter, search } = req.query;
    const filter = {};

    if (clientId) filter.client = clientId;
    if (stage && stage !== "all") filter.stage = stage;

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
      .populate("qcReviewer", "name")
      .sort({ updatedAt: -1 })
      .limit(200);

    res.json({ success: true, tasks });
  } catch (err) {
    console.error("GET /tasks error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 2. GET OVERVIEW & CLIENT METERS ──
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
      client_approval: 0,
      posted: 0,
      completed: 0,
    };

    tasksByStage.forEach(item => {
      if (stageCounts[item._id] !== undefined) {
        stageCounts[item._id] = item.count;
      }
    });

    const clientDeliveries = await ProductionTask.aggregate([
      { $match: { stage: { $in: ["posted", "completed"] } } },
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

// ── 3. CREATE REEL TASK (Initial Script Stage) ──
router.post("/tasks", protect, async (req, res) => {
  try {
    const { client, title, goal, priority, servicePackage, reelNumber, concept, hook, bodyText, cta, writer } = req.body;
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
      concept: concept || "",
      hook: hook || "",
      bodyText: bodyText || "",
      cta: cta || "",
      writer: writer || req.user._id,
      createdBy: req.user._id,
      stage: "script",
    });

    await task.save();
    const populated = await ProductionTask.findById(task._id)
      .populate("client", "businessName mobile")
      .populate("writer", "name");

    res.json({ success: true, task: populated });
  } catch (err) {
    console.error("POST /tasks error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. STEP 1: SCRIPT PASS ➔ MUST ASSIGN SHOOT PERSON & DETAILS ──
router.put("/tasks/:id/pass-script-to-shoot", protect, async (req, res) => {
  try {
    const { shooter, shootDate, shootTime, location, targetReels, shootNote } = req.body;

    if (!shooter) {
      return res.status(400).json({ success: false, message: "Shoot Person (Shooter) is mandatory to pass script to shoot!" });
    }
    if (!shootDate) {
      return res.status(400).json({ success: false, message: "Shoot Date is mandatory!" });
    }

    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    task.scriptStatus = "approved";
    task.scriptApprovedAt = new Date();
    task.stage = "shoot";
    task.shooter = shooter;
    task.shootDate = shootDate;
    task.shootTime = shootTime || "10:00 AM";
    task.location = location || "Client Store";
    task.targetReels = Number(targetReels) || 1;
    task.shootNote = shootNote || "";
    task.shootStatus = "scheduled";

    await task.save();

    // 🔔 Notify assigned shooter
    await sendInAppNotification({
      recipientId: shooter,
      title: `🎥 New Shoot Assigned: ${task.client?.businessName}`,
      message: `You are assigned for shoot on ${task.shootDate} at ${task.shootTime}. Target: ${task.targetReels} Reels.`,
      clientId: task.client?._id,
    });

    res.json({ success: true, message: "Script passed and Shoot Person assigned! 🎬", task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 5. STEP 2: EDIT SHOOT INFO AT ANY TIME (Change Shooter, Time, Location) ──
router.put("/tasks/:id/update-shoot-info", protect, async (req, res) => {
  try {
    const { shooter, shootDate, shootTime, location, targetReels, completedReels, shootNote } = req.body;
    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const shooterChanged = shooter && shooter.toString() !== (task.shooter?.toString() || "");

    if (shooter !== undefined) task.shooter = shooter;
    if (shootDate !== undefined) task.shootDate = shootDate;
    if (shootTime !== undefined) task.shootTime = shootTime;
    if (location !== undefined) task.location = location;
    if (targetReels !== undefined) task.targetReels = targetReels;
    if (completedReels !== undefined) task.completedReels = completedReels;
    if (shootNote !== undefined) task.shootNote = shootNote;

    await task.save();

    if (shooterChanged) {
      await sendInAppNotification({
        recipientId: shooter,
        title: `🎥 Shoot Reassigned: ${task.client?.businessName}`,
        message: `You are assigned for shoot on ${task.shootDate} at ${task.shootTime}. Location: ${task.location}`,
        clientId: task.client?._id,
      });
    }

    res.json({ success: true, message: "Shoot info updated successfully! 🎥", task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 6. STEP 2: SHOOT COMPLETED ➔ AUTOMATIC SHOOTER MONTHLY SCORE CREDIT ──
router.put("/tasks/:id/complete-shoot", protect, async (req, res) => {
  try {
    const { completedReels, rawFootageLink, shootNote } = req.body;
    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    // Strict Permission: Only Admin, Operations Manager, or Assigned Shooter can complete shoot!
    const isMaster = req.user.role === "admin" || req.user.role === "manager";
    const isAssignedShooter = task.shooter && (String(task.shooter) === String(req.user._id));
    if (!isMaster && !isAssignedShooter) {
      return res.status(403).json({
        success: false,
        message: "Access Denied: Only the assigned Shooter, Admin, or Manager can mark this shoot as complete."
      });
    }

    task.shootStatus = "done";
    task.shootCompletedAt = new Date();
    if (completedReels !== undefined) task.completedReels = Number(completedReels);
    if (rawFootageLink) task.rawFootageLink = rawFootageLink;
    if (shootNote) task.shootNote = shootNote;

    await task.save();

    // 🏆 Credit Shooter Score in StaffTimeLog (for today & monthly tracking!)
    const shooterId = task.shooter || req.user._id;
    const todayStr = new Date().toISOString().split("T")[0];

    await StaffTimeLog.findOneAndUpdate(
      { user: shooterId, date: todayStr },
      { $inc: { shootsCompletedCount: 1 } },
      { upsert: false }
    );

    res.json({ success: true, message: "Shoot marked Complete! +1 Shoot credited to Shooter. 🎥", task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 7. STEP 3: HANDOFF TO EDIT ➔ STRICT VALIDATION (RAW DATA & EDITOR REQUIRED!) ──
router.put("/tasks/:id/handoff-to-edit", protect, async (req, res) => {
  try {
    const { rawFootageLink, editor, editorDeadline, editorNotes } = req.body;

    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    const finalLink = rawFootageLink || task.rawFootageLink;
    if (!finalLink || finalLink.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "❌ Raw Footage / Data Link is strictly required to move to Editing stage! (રો ડેટા નાખ્યા વગર આગળ નહિ વધે)",
      });
    }

    const finalEditor = editor || task.editor;
    if (!finalEditor) {
      return res.status(400).json({
        success: false,
        message: "❌ Video Editor assignment is required to move to Editing stage!",
      });
    }

    task.rawFootageLink = finalLink;
    task.editor = finalEditor;
    task.editorAssignedAt = new Date();
    if (editorDeadline) task.editorDeadline = new Date(editorDeadline);
    if (editorNotes) task.editorNotes = editorNotes;
    task.stage = "edit";
    task.editingStatus = "assigned";

    await task.save();

    // 🔔 Notify Video Editor
    await sendInAppNotification({
      recipientId: finalEditor,
      title: `✂️ New Editing Assigned: ${task.client?.businessName}`,
      message: `Raw footage is ready for Reel #${task.reelNumber}. Open Production Hub to edit.`,
      clientId: task.client?._id,
    });

    res.json({ success: true, message: "Raw data verified & handed over to Video Editor! ✂️", task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 8. STEP 4: EDITOR SUBMITS REEL ➔ MOVES TO QC STAGE ──
router.put("/tasks/:id/submit-edit-to-qc", protect, async (req, res) => {
  try {
    const { editedPreviewLink, editorNotes } = req.body;

    if (!editedPreviewLink || editedPreviewLink.trim() === "") {
      return res.status(400).json({ success: false, message: "Please provide the edited video preview link!" });
    }

    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    task.editedPreviewLink = editedPreviewLink;
    if (editorNotes) task.editorNotes = editorNotes;
    task.editingStatus = "review";
    task.editingCompletedAt = new Date();
    task.stage = "qc";
    task.qcStatus = "pending";

    await task.save();

    // 🏆 Credit Editor score in StaffTimeLog
    const editorId = task.editor || req.user._id;
    const todayStr = new Date().toISOString().split("T")[0];
    await StaffTimeLog.findOneAndUpdate(
      { user: editorId, date: todayStr },
      { $inc: { reelsEditedCount: 1 } },
      { upsert: false }
    );

    // 🔔 Notify Admin / Manager for QC
    await sendInAppNotification({
      recipientId: task.createdBy || req.user._id,
      title: `🔍 Reel Ready for QC: ${task.client?.businessName}`,
      message: `Reel #${task.reelNumber} submitted by editor. Please review in QC stage.`,
      clientId: task.client?._id,
    });

    res.json({ success: true, message: "Edited reel submitted to QC! Score credited to editor. 🎉", task });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 9. STEP 5: QC DECISION ➔ REVISIONS BACK TO EDIT OR PASS TO CLIENT APPROVAL ──
router.put("/tasks/:id/qc-decision", protect, async (req, res) => {
  try {
    const { decision, qcNotes } = req.body; // decision: "changes_needed" | "approved"

    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    task.qcReviewer = req.user._id;
    task.qcCompletedAt = new Date();

    if (decision === "changes_needed") {
      task.stage = "edit";
      task.editingStatus = "in_progress";
      task.qcStatus = "changes_requested";
      task.qcNotes = qcNotes || "QC requested revisions. Please check and fix.";

      await task.save();

      // 🔔 Notify Editor about QC revisions
      await sendInAppNotification({
        recipientId: task.editor,
        title: `⚠️ QC Changes on Reel #${task.reelNumber}: ${task.client?.businessName}`,
        message: `Feedback: ${task.qcNotes}`,
        clientId: task.client?._id,
      });

      return res.json({ success: true, message: "Revisions sent back to Video Editor! 🔄", task });
    } else {
      task.stage = "client_approval";
      task.qcStatus = "approved";
      task.clientApprovalStatus = "pending";
      task.qcNotes = qcNotes || "QC Passed";

      await task.save();

      res.json({ success: true, message: "QC Approved! Moved to Client Approval stage. 🌟", task });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 10. STEP 6: CLIENT APPROVAL DECISION ➔ REVISIONS BACK TO EDIT OR READY TO POST ──
router.put("/tasks/:id/client-decision", protect, async (req, res) => {
  try {
    const { decision, clientFeedback, instagramUrl } = req.body; // decision: "changes_needed" | "approved"

    const task = await ProductionTask.findById(req.params.id).populate("client", "businessName");
    if (!task) return res.status(404).json({ success: false, message: "Task not found" });

    if (decision === "changes_needed") {
      task.stage = "edit";
      task.editingStatus = "in_progress";
      task.clientApprovalStatus = "changes_requested";
      task.clientFeedback = clientFeedback || "Client requested changes.";

      await task.save();

      // 🔔 Notify Editor
      await sendInAppNotification({
        recipientId: task.editor,
        title: `⚠️ Client Changes on Reel #${task.reelNumber}: ${task.client?.businessName}`,
        message: `Client Feedback: ${task.clientFeedback}`,
        clientId: task.client?._id,
      });

      return res.json({ success: true, message: "Client changes sent back to Video Editor! 🔄", task });
    } else {
      task.stage = "posted";
      task.clientApprovalStatus = "approved";
      task.clientApprovedAt = new Date();
      task.isDelivered = true;
      task.deliveredAt = new Date();
      if (instagramUrl) task.instagramUrl = instagramUrl;

      await task.save();

      res.json({ success: true, message: "Reel Approved & Marked Ready to Post! Client quota updated! 🚀", task });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 11. DELETE TASK ──
router.delete("/tasks/:id", protect, async (req, res) => {
  try {
    await ProductionTask.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Task deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
