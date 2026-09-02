const mongoose = require("mongoose");

const productionTaskSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    servicePackage: { type: String, default: "" },
    title:          { type: String, required: true, trim: true },
    reelNumber:     { type: Number, default: 1 },
    goal: {
      type: String,
      enum: ["Authority", "Trust", "Sales", "Awareness", "Viral"],
      default: "Authority",
    },
    stage: {
      type: String,
      enum: ["script", "shoot", "edit", "qc", "delivery", "completed"],
      default: "script",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },

    // ── STAGE 1: SCRIPT / CONCEPT ──
    writer:           { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    concept:          { type: String, default: "" },
    hook:             { type: String, default: "" },
    bodyText:         { type: String, default: "" },
    cta:              { type: String, default: "" },
    scriptStatus: {
      type: String,
      enum: ["pending", "drafted", "approved", "changes_needed"],
      default: "pending",
    },
    scriptApprovedAt: { type: Date, default: null },
    scriptNotes:      { type: String, default: "" },

    // ── STAGE 2: SHOOT OPERATIONS ──
    shooter:          { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    shootDate:        { type: String, default: "" },   // YYYY-MM-DD
    shootTime:        { type: String, default: "" },   // e.g. "3:00 PM"
    location:         { type: String, default: "" },
    targetReels:      { type: Number, default: 1 },
    completedReels:   { type: Number, default: 0 },
    shootStatus: {
      type: String,
      enum: ["scheduled", "in_progress", "done", "cancelled"],
      default: "scheduled",
    },
    rawFootageLink:   { type: String, default: "" },   // Drive / Cloud link
    shootNote:        { type: String, default: "" },
    shootCompletedAt: { type: Date, default: null },

    // ── STAGE 3: VIDEO EDITING & GAMIFICATION ──
    editor:           { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    editorAssignedAt: { type: Date, default: null },
    editorDeadline:   { type: Date, default: null },
    editingStatus: {
      type: String,
      enum: ["assigned", "in_progress", "review", "completed"],
      default: "assigned",
    },
    editedPreviewLink:   { type: String, default: "" },
    editorNotes:         { type: String, default: "" },
    reelsCountCredited:  { type: Number, default: 1 },
    editingCompletedAt:  { type: Date, default: null },

    // ── STAGE 4: DELIVERY & CLIENT METER ──
    isDelivered:   { type: Boolean, default: false },
    deliveredAt:   { type: Date, default: null },
    instagramUrl:  { type: String, default: "" },
    clientNotes:   { type: String, default: "" },

    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

productionTaskSchema.index({ client: 1, stage: 1 });
productionTaskSchema.index({ editor: 1, editingStatus: 1 });
productionTaskSchema.index({ shooter: 1, shootStatus: 1 });
productionTaskSchema.index({ writer: 1, scriptStatus: 1 });

module.exports = mongoose.model("ProductionTask", productionTaskSchema);
