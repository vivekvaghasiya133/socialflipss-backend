const mongoose = require("mongoose");

// Package / deliverables structure
const packageSchema = new mongoose.Schema({
  name:         { type: String, default: "" },       // e.g. "Growth Plan"
  amount:       { type: Number, default: 0 },        // monthly amount
  startDate:    { type: Date,   default: null },
  endDate:      { type: Date,   default: null },
  deliverables: [{
    type:     { type: String },                      // e.g. "Reels", "Posts", "Stories"
    quantity: { type: Number, default: 0 },          // e.g. 8
    note:     { type: String, default: "" },
  }],
});

const clientSchema = new mongoose.Schema(
  {
    // ── Basic Info ───────────────────────────────────────────────
    businessName:  { type: String, required: true, trim: true },
    ownerName:     { type: String, required: true, trim: true },
    mobile:        { type: String, required: true, trim: true },
    email:         { type: String, trim: true, lowercase: true },
    city:          { type: String, trim: true },
    industry:      { type: String, trim: true },
    website:       { type: String, trim: true },
    instagramPage: { type: String, trim: true },

    // ── Onboarding Form Data ─────────────────────────────────────
    description:      { type: String, default: "" },
    targetAudience:   { type: String, default: "" },
    services:         { type: String, default: "" },
    competitors:      { type: String, default: "" },
    usp:              { type: String, default: "" },
    brandColors:      { type: String, default: "" },
    tone:             { type: String, default: "" },
    contentTypes:     [{ type: String }],
    platforms:        [{ type: String }],
    goal:             { type: String, default: "" },
    inspirationLink:  { type: String, default: "" },
    referral:         { type: String, default: "" },
    notes:            { type: String, default: "" },

    // ── Package ──────────────────────────────────────────────────
    package: { type: packageSchema, default: () => ({}) },

    // ── Status ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["onboarding", "active", "paused", "churned"],
      default: "onboarding",
    },

    // ── Converted from lead ──────────────────────────────────────
    leadId:     { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // ── Internal notes ───────────────────────────────────────────
    internalNotes: { type: String, default: "" },

    onboardingDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);
