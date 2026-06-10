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
    reelTopics:     { type: [String], default: () => Array(15).fill("") }, // Array of 15 topics
    notes:          { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Strategy", strategySchema);
