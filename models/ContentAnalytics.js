const mongoose = require("mongoose");

const contentAnalyticsSchema = new mongoose.Schema(
  {
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Content",
      required: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    views:  { type: Number, default: 0 },
    saves:  { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    leads:  { type: Number, default: 0 },
    result: {
      type: String,
      enum: ["Winner", "Average", "Loser"],
      default: "Average",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ContentAnalytics", contentAnalyticsSchema);
