const mongoose = require("mongoose");

const projectSchema = new mongoose.Schema(
  {
    clientId:    { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    name:        { type: String, required: true, trim: true }, // e.g. "April 2026 Plan"
    month:       { type: String, default: "" },                // "2026-04"
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["planning", "active", "completed", "on_hold"],
      default: "planning",
    },

    // Monthly plan details
    monthlyGoal:  { type: String, default: "" },
    contentCount: { type: Number, default: 0 },   // Total content pieces planned

    // Advance payment received before project start
    advancePaid:  { type: Boolean, default: false },
    advanceAmount:{ type: Number,  default: 0 },

    // Team assigned
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    startDate: { type: Date, default: null },
    endDate:   { type: Date, default: null },
    notes:     { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Project", projectSchema);
