const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    // ── Step 1: Basic Info ──────────────────────────────
    businessName: { type: String, required: true, trim: true },
    ownerName:    { type: String, required: true, trim: true },
    mobile:       { type: String, required: true, trim: true },
    email:        { type: String, trim: true, lowercase: true },
    city:         { type: String, required: true, trim: true },
    industry:     { type: String, required: true },
    website:      { type: String, trim: true },

    // ── Step 2: Business Details ────────────────────────
    description:    { type: String },
    targetAudience: { type: String },
    services:       { type: String },
    competitors:    { type: String },
    usp:            { type: String },
    revenue:        { type: String },

    // ── Step 3: Goals & Services ────────────────────────
    platforms:        [{ type: String }],
    goal:             { type: String },
    selectedServices: [{ type: String }],
    expectations:     { type: String },

    // ── Step 4: Content & Budget ────────────────────────
    tone:            { type: String },
    contentTypes:    [{ type: String }],
    postFrequency:   { type: String },
    budget:          { type: String },
    brandColors:     { type: String },
    inspirationLink: { type: String },

    // ── Step 5: Final Details ───────────────────────────
    prevExp:     { type: String },
    prevProblem: { type: String },
    contactTime: { type: String },
    reporting:   { type: String },
    notes:       { type: String },
    referral:    { type: String },
    agreed:      { type: Boolean, default: false },

    // ── Admin / Internal Fields ─────────────────────────
    status: {
      type: String,
      enum: ["new", "in_progress", "active", "paused", "completed"],
      default: "new",
    },
    assignedTo:   { type: String, default: "" },
    internalNotes:{ type: String, default: "" },
    onboardingDate: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Client", clientSchema);
