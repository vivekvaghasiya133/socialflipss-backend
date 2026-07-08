const express = require("express");
const Strategy = require("../models/Strategy");
const Client = require("../models/Client");
const Project = require("../models/Project");
const Content = require("../models/Content");
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
        return { title: topic, brief: "", scriptText: "", status: "Draft", approvedBy: "", feedback: "", contentId: null };
      }
      
      let contentScript = "";
      let actualContentId = topic.contentId;
      if (topic.contentId && typeof topic.contentId === "object") {
        contentScript = topic.contentId.scriptText || "";
        actualContentId = topic.contentId._id;
      }

      return {
        ...topic,
        scriptText: topic.scriptText || contentScript || "",
        approvedBy: topic.approvedBy || "",
        contentId: actualContentId
      };
    });
  }
  return doc;
}

// Helper to sync strategy topics to Content items in "idea" stage
async function syncStrategyTopicsToContent(strategy) {
  const cid = strategy.clientId?._id || strategy.clientId;
  let project = await Project.findOne({ clientId: cid, month: strategy.month });
  if (!project) {
    const client = await Client.findById(cid);
    const clientName = client ? client.businessName : "Client";
    project = await Project.create({
      clientId: cid,
      name: `${clientName} - ${strategy.month} Plan`,
      month: strategy.month,
      status: "active",
      createdBy: strategy.strategist?._id || strategy.strategist,
    });
  }

  let modified = false;
  if (strategy.reelTopics && strategy.reelTopics.length) {
    for (let topic of strategy.reelTopics) {
      if (topic.title) {
        // Automatically set status to "Review" (Awaiting Review) if it was "Draft" and has a title
        if (topic.status === "Draft") {
          topic.status = "Review";
          modified = true;
        }

        const isApproved = topic.status === "Approved";
        const hasScript = Boolean(topic.scriptText && topic.scriptText.trim());
        const stage = isApproved ? (hasScript ? "shoot" : "script") : "idea";
        const scriptApproved = isApproved && hasScript;
        const scriptApprovalStatus = isApproved && hasScript ? "approved" : "pending";
        const approvalNote = isApproved 
          ? (topic.approvedBy === "admin" 
              ? "Approved by Admin (SocialFlipss) on behalf of client." 
              : "Approved by Client.")
          : "";

        if (!topic.contentId) {
          const newContent = await Content.create({
            clientId: cid,
            projectId: project._id,
            title: topic.title,
            description: topic.brief || "",
            scriptText: topic.scriptText || "",
            scriptApproved,
            scriptApprovalStatus,
            approvalNote,
            type: "reel",
            stage,
            createdBy: strategy.strategist?._id || strategy.strategist,
          });
          topic.contentId = newContent._id;
          modified = true;
        } else {
          await Content.findByIdAndUpdate(topic.contentId, {
            projectId: project._id,
            title: topic.title,
            description: topic.brief || "",
            scriptText: topic.scriptText || "",
            scriptApproved,
            scriptApprovalStatus,
            stage,
            approvalNote
          });
        }
      } else {
        // Reset status to "Draft" if title is cleared
        if (topic.status !== "Draft") {
          topic.status = "Draft";
          modified = true;
        }
      }
    }
  }

  if (modified) {
    strategy.markModified("reelTopics");
    await strategy.save();
  }
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
      .populate("reelTopics.contentId")
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
      .populate("strategist", "name")
      .populate("reelTopics.contentId");
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
      let targetCount = 0;
      if (client && client.package && client.package.deliverables) {
        client.package.deliverables.forEach(d => {
          const typeLower = (d.type || "").toLowerCase();
          if (
            typeLower.includes("reel") ||
            typeLower.includes("ugc") ||
            typeLower.includes("video") ||
            typeLower.includes("post") ||
            typeLower.includes("carousel") ||
            typeLower.includes("youtube")
          ) {
            targetCount += d.quantity || 0;
          }
        });
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

    await syncStrategyTopicsToContent(strategy);

    const populated = await strategy.populate(["clientId", "strategist", "reelTopics.contentId"]);
    res.status(201).json(normalizeStrategy(populated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PUT /api/strategies/:id
router.put("/:id", authorize("admin", "manager", "team"), async (req, res) => {
  try {
    const existing = await Strategy.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    if (req.body.reelTopics && req.body.reelTopics.length) {
      req.body.reelTopics = req.body.reelTopics.map((item, idx) => {
        if (typeof item === "string") {
          item = { title: item, brief: "", status: "Draft", feedback: "", contentId: null };
        }
        // Preserve client review status, feedback, and linked contentId from existing DB topic
        const oldTopic = existing.reelTopics && existing.reelTopics[idx];
        if (oldTopic) {
          return {
            ...item,
            status: item.status !== "Draft" ? item.status : (oldTopic.status || "Draft"),
            feedback: item.feedback || oldTopic.feedback || "",
            contentId: item.contentId || oldTopic.contentId || null,
          };
        }
        return item;
      });
    }
    const strategy = await Strategy.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!strategy) return res.status(404).json({ message: "Not found" });

    await syncStrategyTopicsToContent(strategy);

    const populated = await strategy.populate([
      { path: "clientId", select: "businessName ownerName" },
      { path: "strategist", select: "name" },
      { path: "reelTopics.contentId" }
    ]);
    res.json(normalizeStrategy(populated));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// DELETE /api/strategies/:id
router.delete("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const strategy = await Strategy.findById(req.params.id);
    if (!strategy) return res.status(404).json({ message: "Not found" });

    const cid = strategy.clientId;
    const month = strategy.month;

    // 1. Delete associated Project, Content, and other related records
    const project = await Project.findOne({ clientId: cid, month });
    if (project) {
      // Delete all Content items under this project
      await Content.deleteMany({ projectId: project._id });
      
      // Delete associated ShootSchedules
      const ShootSchedule = require("../models/ShootSchedule");
      await ShootSchedule.deleteMany({ projectId: project._id });

      // Delete associated WorkLogs
      const WorkLog = require("../models/WorkLog");
      await WorkLog.deleteMany({ projectId: project._id });

      // Delete the Project itself
      await Project.findByIdAndDelete(project._id);
    } else {
      // Fallback: Delete content items linked in reelTopics
      const contentIds = (strategy.reelTopics || [])
        .map(t => t.contentId)
        .filter(id => id);
      if (contentIds.length) {
        await Content.deleteMany({ _id: { $in: contentIds } });
      }
    }

    // 2. Delete Strategy itself
    await Strategy.findByIdAndDelete(req.params.id);

    res.json({ message: "Strategy, associated project, and all content cards deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

module.exports = router;
