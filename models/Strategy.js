const mongoose = require("mongoose");

const strategySchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    month: {
      type: String, // e.g. "2026-06"
      required: true,
    },
    strategist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["Draft", "Review", "Approved"],
      default: "Draft",
    },
    businessGoal:   { type: String, default: "" },
    targetAudience: { type: String, default: "" },
    contentPillars: { type: String, default: "" },
    competitors:    { type: String, default: "" },
    monthlyPlan:    { type: String, default: "" },
    reelTopics: {
      type: [
        {
          title:      { type: String, default: "" },
          brief:      { type: String, default: "" },
          scriptText: { type: String, default: "" },
          status:     { type: String, enum: ["Draft", "Review", "Approved", "Changes Requested"], default: "Draft" },
          approvedBy: { type: String, default: "" },
          feedback:   { type: String, default: "" },
          contentId:  { type: mongoose.Schema.Types.ObjectId, ref: "Content", default: null }
        }
      ],
      default: () => Array(15).fill(null).map(() => ({
        title: "", brief: "", scriptText: "", status: "Draft", approvedBy: "", feedback: "", contentId: null
      }))
    },
    notes:          { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Strategy", strategySchema);
