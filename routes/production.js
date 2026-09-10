// ── HELPER: STRICT CONTINUOUS REEL NUMBER SEQUENCE PER CLIENT (1, 2, 3, 4...) ──
async function autoResequenceClientTasks(clientId) {
  if (!clientId) return;
  try {
    const clientTasks = await ProductionTask.find({ client: clientId }).sort({ createdAt: 1, _id: 1 });
    for (let i = 0; i < clientTasks.length; i++) {
      const expected = i + 1;
      if (clientTasks[i].reelNumber !== expected) {
        clientTasks[i].reelNumber = expected;
        await clientTasks[i].save();
      }
    }
  } catch (err) {
    console.error("autoResequenceClientTasks error:", err);
  }
}

// Auto-sync sequence on startup
setTimeout(async () => {
  try {
    const clientIds = await ProductionTask.distinct("client");
    for (const cId of clientIds) {
      if (cId) await autoResequenceClientTasks(cId);
    }
    console.log("✓ Production reel sequences verified & synchronized across all clients");
  } catch (e) {
    console.error("Initial resequence error:", e);
  }
}, 1200);

const express = require("express");
const router  = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const ProductionTask = require("../models/ProductionTask");

async function resolveUserId(val) {
  if (!val || val === '' || val === 'null' || val === 'undefined') return null;
  if (mongoose.Types.ObjectId.isValid(val) && String(new mongoose.Types.ObjectId(val)) === String(val)) {
    return val;
  }
  try {
    const cleanName = String(val).replace(/\(.*\)/, '').trim();
    if (cleanName) {
      const matched = await User.findOne({ name: { $regex: new RegExp('^' + cleanName, 'i') } });
      if (matched) return matched._id;
    }
  } catch (e) {}
  return null;
}
const StaffTimeLog   = require("../models/StaffTimeLog");
const Client         = require("../models/Client");
const Notification   = require("../models/Notification");
const { protect }    = require("../middleware/auth");

// Helper to create notifications
const whatsappService = require("../services/whatsappService");

// Helper to automatically notify via WhatsApp + generate waLink for fallback
const sendStageWhatsAppNotification = async ({ recipientUserId, messageText }) => {
  try {
    if (!recipientUserId) return { sent: false, waLink: "" };
    const user = await User.findById(recipientUserId).select("name mobile");
    if (!user || !user.mobile) return { sent: false, waLink: "" };

    const result = await whatsappService.sendWhatsAppMessage(user.mobile, messageText);
    return {
      sent: Boolean(result.success),
      waLink: result.waLink || whatsappService.createWaMeLink(user.mobile, messageText),
      recipientName: user.name,
      mobile: user.mobile,
    };
  } catch (err) {
    console.warn("sendStageWhatsAppNotification error:", err.message);
    return { sent: false, waLink: "" };
  }
};

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
      .populate("writer", "name avatar mobile")
      .populate("shooter", "name avatar mobile")
      .populate("editor", "name avatar mobile")
      .populate("qcReviewer", "name")
      .sort({ reelNumber: 1, createdAt: 1 })
      .limit(200);

    // 🔒 STRICT PRIVACY: Only Admin and Manager can access client phone numbers and pricing/billing details
    const isMaster = req.user.role === "admin" || req.user.role === "manager";
    const sanitizedTasks = tasks.map(task => {
      const doc = task.toObject();
      if (!isMaster) {
        if (doc.client) {
          doc.client.mobile = "••••••••••";
          doc.client.ownerName = "";
        }
        delete doc.videoPrice;
        delete doc.billingStatus;
        delete doc.billingMonth;
        delete doc.invoiceId;
      }
      return doc;
    });

    res.json({ success: true, tasks: sanitizedTasks });
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

    const clientInProgress = await ProductionTask.aggregate([
      { $match: { stage: { $nin: ["posted", "completed"] } } },
      { $group: { _id: "$client", inProgressCount: { $sum: 1 } } }
    ]);

    const deliveryMap = {};
    clientDeliveries.forEach(d => {
      deliveryMap[d._id.toString()] = d.deliveredCount;
    });

    const inProgressMap = {};
    clientInProgress.forEach(d => {
      inProgressMap[d._id.toString()] = d.inProgressCount;
    });

    const clientQuotas = clients.map(c => {
      const reelsQuota = c.package?.deliverables?.find(d => /reel/i.test(d.type || ""))?.quantity || 30;
      const delivered = deliveryMap[c._id.toString()] || 0;
      const inProgress = inProgressMap[c._id.toString()] || 0;
      return {
        _id: c._id,
        businessName: c.businessName,
        packageName: c.package?.name || "Custom Retainer",
        quota: reelsQuota,
        delivered,
        inProgress,
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

    // Auto-calculate continuous reelNumber for this client (no duplicates!)
    const existingCount = await ProductionTask.countDocuments({ client });
    const maxTask = await ProductionTask.findOne({ client }).sort({ reelNumber: -1 });
    const nextNumber = maxTask && maxTask.reelNumber ? Math.max(maxTask.reelNumber + 1, existingCount + 1) : 1;

    let finalReelNumber = Number(reelNumber);
    // If not provided, or < 1, or default 1 passed when client already has tasks -> auto assign next sequential number
    if (!finalReelNumber || finalReelNumber < 1 || (finalReelNumber === 1 && existingCount > 0)) {
      finalReelNumber = nextNumber;
    }

    const resolvedShooter = await resolveUserId(req.body.shooter);
    const resolvedEditor = await resolveUserId(req.body.editor);
    const resolvedWriter = (await resolveUserId(writer)) || req.user._id;

    const isMaster = req.user.role === "admin" || req.user.role === "manager";
    const serviceType = req.body.serviceType || "full";
    const videoPrice = isMaster ? (Number(req.body.videoPrice) || 0) : 0;
    let initialStage = req.body.stage;
    let scriptStatus = "pending";
    let shootStatus = "scheduled";
    let editingStatus = "assigned";

    if (serviceType === "only_editing") {
      initialStage = req.body.stage || "edit";
      scriptStatus = "approved";
      shootStatus = "done";
    } else if (serviceType === "only_shooting") {
      initialStage = req.body.stage || "shoot";
      scriptStatus = "approved";
    } else {
      initialStage = req.body.stage || "script";
    }

    const task = new ProductionTask({
      client,
      title,
      goal: goal || "Authority",
      priority: priority || "medium",
      servicePackage: servicePackage || "",
      serviceType,
      videoPrice,
      reelNumber: finalReelNumber,
      concept: concept || "",
      hook: hook || "",
      bodyText: bodyText || "",
      cta: cta || "",
      writer: resolvedWriter,
      createdBy: req.user._id,
      stage: initialStage,
      scriptStatus,
      shootStatus,
      editingStatus,
      shooter: resolvedShooter,
      shootDate: req.body.shootDate || "",
      shootTime: req.body.shootTime || "",
      location: req.body.location || "",
      rawFootageLink: req.body.rawFootageLink || "",
      editor: resolvedEditor,
      editedPreviewLink: req.body.editedPreviewLink || "",
    });

    await task.save();
    const populated = await ProductionTask.findById(task._id)
      .populate("client", "businessName mobile")
      .populate("writer", "name")
      .populate("shooter", "name")
      .populate("editor", "name");

    const doc = populated.toObject();
    if (!isMaster) {
      if (doc.client) {
        doc.client.mobile = "••••••••••";
        doc.client.ownerName = "";
      }
      delete doc.videoPrice;
      delete doc.billingStatus;
      delete doc.billingMonth;
      delete doc.invoiceId;
    }
    res.json({ success: true, task: doc });
  } catch (err) {
    console.error("POST /tasks error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4B. STEP 1 BATCH: PASS MULTIPLE SCRIPTS TO SHOOT TOGETHER ──
router.put("/tasks/batch-pass-to-shoot", protect, async (req, res) => {
  try {
    const { taskIds, shooter, shootDate, shootTime, location, targetReels, shootNote } = req.body;

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ success: false, message: "Please select at least one task." });
    }
    if (!shooter) {
      return res.status(400).json({ success: false, message: "Shoot Person (Shooter) is mandatory!" });
    }
    if (!shootDate) {
      return res.status(400).json({ success: false, message: "Shoot Date is mandatory!" });
    }

    const tasks = await ProductionTask.find({ _id: { $in: taskIds } }).populate("client", "businessName");
    if (tasks.length === 0) {
      return res.status(404).json({ success: false, message: "No tasks found." });
    }

    const now = new Date();
    await ProductionTask.updateMany(
      { _id: { $in: taskIds } },
      {
        $set: {
          scriptStatus: "approved",
          scriptApprovedAt: now,
          stage: "shoot",
          shooter,
          shootDate,
          shootTime: shootTime || "03:00 PM",
          location: location || "Client Store",
          targetReels: Number(targetReels) || taskIds.length,
          shootNote: shootNote || "",
          shootStatus: "scheduled",
        }
      }
    );

    const clientName = tasks[0]?.client?.businessName || "Client";
    await sendInAppNotification({
      recipientId: shooter,
      title: "🎥 New Shoot Assigned: " + clientName + " (" + tasks.length + " Reels)",
      message: "You are assigned for " + tasks.length + " Reels shoot on " + shootDate + " at " + (shootTime || "03:00 PM") + ". Target: " + (targetReels || tasks.length) + " Reels.",
      clientId: tasks[0]?.client?._id,
    });

    const waBatchText =
      `🎥 *New Shoot Assignment — SocialFlipss* 🎬\n\n` +
      `Namaste 👋\n` +
      `તમને નવા શૂટિંગની જવાબદારી સોંપવામાં આવી છે:\n\n` +
      `🏢 Client: *${clientName}*\n` +
      `🎬 Reels: *${tasks.length} Reels*\n` +
      `📅 Date: *${shootDate}*\n` +
      `⏰ Time: *${shootTime || "03:00 PM"}*\n` +
      `📍 Location: *${location || "Client Store"}*\n` +
      `🎯 Target: *${targetReels || tasks.length} Reels*\n` +
      (shootNote ? `📝 Note: ${shootNote}\n` : "") +
      `\nPlease reach on time. Flip The Game! 🚀`;

    const waResult = await sendStageWhatsAppNotification({
      recipientUserId: shooter,
      messageText: waBatchText,
    });

    res.json({
      success: true,
      message: tasks.length + " Scripts passed and assigned to Shoot successfully! 🎬",
      count: tasks.length,
      whatsapp: waResult,
    });
  } catch (err) {
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

    const clientName = task.client?.businessName || "Client";
    const waText =
      `🎥 *New Shoot Assignment — SocialFlipss* 🎬\n\n` +
      `Namaste 👋\n` +
      `તમને નવા શૂટિંગની જવાબદારી સોંપવામાં આવી છે:\n\n` +
      `🏢 Client: *${clientName}*\n` +
      `🎞️ Reel: *#${task.reelNumber} — ${task.title}*\n` +
      `📅 Date: *${task.shootDate}*\n` +
      `⏰ Time: *${task.shootTime}*\n` +
      `📍 Location: *${task.location}*\n` +
      `🎯 Target: *${task.targetReels} Reels*\n` +
      (task.shootNote ? `📝 Note: ${task.shootNote}\n` : "") +
      `\nPlease reach on time. Flip The Game! 🚀`;

    const waResult = await sendStageWhatsAppNotification({
      recipientUserId: shooter,
      messageText: waText,
    });

    res.json({
      success: true,
      message: "Script passed and Shoot Person assigned! 🎬",
      task,
      whatsapp: waResult
    });
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

    // If task is 'only_shooting', completing shoot immediately marks it delivered/completed!
    if (task.serviceType === "only_shooting") {
      task.stage = "completed";
      task.isDelivered = true;
      task.deliveredAt = new Date();
    }

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

// ── 7B. STEP 3 BATCH: HANDOFF MULTIPLE REELS TO EDIT TOGETHER ──
router.put("/tasks/batch-handoff-to-edit", protect, async (req, res) => {
  try {
    const { handoffs } = req.body;

    if (!Array.isArray(handoffs) || handoffs.length === 0) {
      return res.status(400).json({ success: false, message: "Please select at least one reel to handoff." });
    }

    // Validate each handoff item
    for (let i = 0; i < handoffs.length; i++) {
      const item = handoffs[i];
      if (!item.taskId) {
        return res.status(400).json({ success: false, message: "Task ID missing for item #" + (i + 1) });
      }
      if (!item.rawFootageLink || item.rawFootageLink.trim() === "") {
        return res.status(400).json({
          success: false,
          message: "❌ Raw Footage / Data Link is strictly required for Reel #" + (item.reelNumber || (i + 1)) + "! (રો ડેટા નાખ્યા વગર આગળ નહિ વધે)",
        });
      }
      if (!item.editor) {
        return res.status(400).json({
          success: false,
          message: "❌ Video Editor assignment is required for Reel #" + (item.reelNumber || (i + 1)) + "!",
        });
      }
    }

    const updatedTasks = [];
    const now = new Date();

    for (const item of handoffs) {
      const task = await ProductionTask.findById(item.taskId).populate("client", "businessName");
      if (!task) continue;

      task.rawFootageLink = item.rawFootageLink.trim();
      task.editor = item.editor;
      task.editorAssignedAt = now;
      if (item.editorDeadline) task.editorDeadline = new Date(item.editorDeadline);
      if (item.editorNotes) task.editorNotes = item.editorNotes.trim();
      task.stage = "edit";
      task.editingStatus = "assigned";

      await task.save();
      updatedTasks.push(task);

      // Notify Video Editor
      try {
        await sendInAppNotification({
          recipientId: item.editor,
          title: "✂️ New Editing Assigned: " + (task.client?.businessName || "Client"),
          message: "Raw footage is ready for Reel #" + task.reelNumber + " (" + (task.title || "Reel") + "). Open Production Hub to edit.",
          clientId: task.client?._id,
        });

        const editWaText =
          `✂️ *New Video Editing Assigned — SocialFlipss* 🎬\n\n` +
          `Namaste 👋\n` +
          `તમને નવી રીલ એડિટિંગનું કામ સોંપવામાં આવ્યું છે:\n\n` +
          `🏢 Client: *${task.client?.businessName || "Client"}*\n` +
          `🎞️ Reel: *#${task.reelNumber} — ${task.title || "Reel"}*\n` +
          `🔗 Raw Footage Link: ${task.rawFootageLink}\n` +
          (task.editorDeadline ? `⏳ Deadline: *${new Date(task.editorDeadline).toLocaleDateString("en-IN")}*\n` : "") +
          (task.editorNotes ? `📝 Notes: ${task.editorNotes}\n` : "") +
          `\nLet's make it viral! 🚀`;

        await sendStageWhatsAppNotification({
          recipientUserId: item.editor,
          messageText: editWaText,
        });
      } catch (notifErr) {
        console.error("Notification error:", notifErr);
      }
    }

    res.json({
      success: true,
      message: "Successfully handed off " + updatedTasks.length + " Reels to Video Editing! ✂️",
      count: updatedTasks.length,
      tasks: updatedTasks,
    });
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

    const editWaText =
      `✂️ *New Video Editing Assigned — SocialFlipss* 🎬\n\n` +
      `Namaste 👋\n` +
      `તમને નવી રીલ એડિટિંગનું કામ સોંપવામાં આવ્યું છે:\n\n` +
      `🏢 Client: *${task.client?.businessName || "Client"}*\n` +
      `🎞️ Reel: *#${task.reelNumber} — ${task.title}*\n` +
      `🔗 Raw Footage Link: ${task.rawFootageLink}\n` +
      (task.editorDeadline ? `⏳ Deadline: *${new Date(task.editorDeadline).toLocaleDateString("en-IN")}*\n` : "") +
      (task.editorNotes ? `📝 Notes: ${task.editorNotes}\n` : "") +
      `\nLet's make it viral! 🚀`;

    const waResult = await sendStageWhatsAppNotification({
      recipientUserId: finalEditor,
      messageText: editWaText,
    });

    res.json({
      success: true,
      message: "Raw data verified & handed over to Video Editor! ✂️",
      task,
      whatsapp: waResult
    });
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

    const submitWaText =
      `🔍 *Reel Ready for QC Review — SocialFlipss* 🎬\n\n` +
      `Namaste 👋\n` +
      `એડિટરે નવી રીલ QC માટે સબમિટ કરી છે:\n\n` +
      `🏢 Client: *${task.client?.businessName || "Client"}*\n` +
      `🎞️ Reel: *#${task.reelNumber} — ${task.title || "Reel"}*\n` +
      `🔗 Preview: ${task.editedPreviewLink}\n` +
      (task.editorNotes ? `📝 Note: ${task.editorNotes}\n` : "") +
      `\nકૃપા કરીને Production Hub માં QC ચેક કરો. 🚀`;

    const waResult = await sendStageWhatsAppNotification({
      recipientUserId: task.createdBy || req.user._id,
      messageText: submitWaText,
    });

    res.json({ success: true, message: "Edited reel submitted to QC! Score credited to editor. 🎉", task, whatsapp: waResult });
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

      const qcWaText =
        `⚠️ *QC Changes Requested — SocialFlipss* 🎬\n\n` +
        `Namaste 👋\n` +
        `રીલ એડિટિંગમાં સુધારા (changes) આવ્યા છે:\n\n` +
        `🏢 Client: *${task.client?.businessName || "Client"}*\n` +
        `🎞️ Reel: *#${task.reelNumber} — ${task.title || "Reel"}*\n` +
        `📝 QC Feedback: *${task.qcNotes}*\n\n` +
        `કૃપા કરીને ચેક કરીને સુધારીને ફરી સબમિટ કરો. 🚀`;

      const waResult = await sendStageWhatsAppNotification({
        recipientUserId: task.editor,
        messageText: qcWaText,
      });

      return res.json({ success: true, message: "Revisions sent back to Video Editor! 🔄", task, whatsapp: waResult });
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

// ── 10B. UPDATE TASK GENERAL / KANBAN DRAG & DROP STAGE TRANSITIONS ──
router.put("/tasks/:id", protect, async (req, res) => {
  try {
    const task = await ProductionTask.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    const updatableFields = [
      "title", "goal", "priority", "servicePackage", "concept", "hook",
      "bodyText", "cta", "scriptStatus", "scriptNotes", "writer",
      "shooter", "shootDate", "shootTime", "location", "targetReels",
      "completedReels", "shootStatus", "rawFootageLink", "shootNote",
      "editor", "editingStatus", "editedPreviewLink", "editorNotes",
      "qcReviewer", "qcNotes", "qcStatus", "clientApprovalStatus",
      "clientFeedback", "instagramUrl", "clientNotes", "stage", "serviceType", "videoPrice", "billingStatus", "billingMonth"
    ];

    const isMaster = req.user.role === "admin" || req.user.role === "manager";
    updatableFields.forEach(f => {
      if (req.body[f] !== undefined) {
        if (!isMaster && (f === "videoPrice" || f === "billingStatus" || f === "billingMonth" || f === "invoiceId")) {
          return; // Skip pricing/billing updates for non-master
        }
        task[f] = req.body[f];
      }
    });

    if (req.body.stage === "posted" || req.body.stage === "completed") {
      task.isDelivered = true;
      if (!task.deliveredAt) task.deliveredAt = new Date();
    }

    await task.save();

    const populated = await ProductionTask.findById(task._id)
      .populate("client", "businessName mobile package")
      .populate("writer", "name role")
      .populate("shooter", "name role")
      .populate("editor", "name role")
      .populate("qcReviewer", "name role");

    const doc = populated.toObject();
    if (!isMaster) {
      if (doc.client) {
        doc.client.mobile = "••••••••••";
        doc.client.ownerName = "";
      }
      delete doc.videoPrice;
      delete doc.billingStatus;
      delete doc.billingMonth;
      delete doc.invoiceId;
    }

    res.json({ success: true, task: doc, message: "Task updated successfully!" });
  } catch (err) {
    console.error("PUT /tasks/:id error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 11. DELETE TASK ──
router.delete("/tasks/:id", protect, async (req, res) => {
  try {
    const task = await ProductionTask.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found" });
    }

    // 🔒 STRICT SECURITY: Only Admin can delete production reel tasks!
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access Denied: Only Admin can delete production reel tasks." });
    }

    const clientId = task.client;
    await ProductionTask.findByIdAndDelete(req.params.id);
    await autoResequenceClientTasks(clientId);
    res.json({ success: true, message: "Task deleted and sequence re-numbered successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 12. MANUAL RESEQUENCE REELS ENDPOINT ──
router.post("/tasks/resequence", protect, async (req, res) => {
  try {
    const clientIds = await ProductionTask.distinct("client");
    for (const cId of clientIds) {
      if (cId) await autoResequenceClientTasks(cId);
    }
    const tasks = await ProductionTask.find()
      .populate("client", "businessName")
      .sort({ client: 1, reelNumber: 1 });
    res.json({ success: true, message: "Reel sequence synced successfully!", count: tasks.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
