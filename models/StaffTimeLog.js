const mongoose = require("mongoose");

const breakSchema = new mongoose.Schema(
  {
    startTime: { type: Date, required: true },
    endTime:   { type: Date, default: null },
    durationMinutes: { type: Number, default: 0 },
    reason: {
      type: String,
      enum: ["lunch", "tea", "personal", "meeting", "other"],
      default: "lunch",
    },
    note: { type: String, default: "" },
  },
  { _id: true }
);

const staffTimeLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: String, // "YYYY-MM-DD"
      required: true,
    },
    punchInTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    punchInLocation: { type: String, default: "Office" },
    punchOutTime:    { type: Date, default: null },
    punchOutLocation:{ type: String, default: "" },

    breaks: [breakSchema],

    totalWorkMinutes:  { type: Number, default: 0 },
    totalBreakMinutes: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["punched_in", "on_break", "punched_out"],
      default: "punched_in",
    },

    // ── Daily Output / Productivity ──
    reelsEditedCount:     { type: Number, default: 0 },
    shootsCompletedCount: { type: Number, default: 0 },
    scriptsWrittenCount:  { type: Number, default: 0 },

    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

staffTimeLogSchema.index({ user: 1, date: 1 }, { unique: true });
staffTimeLogSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model("StaffTimeLog", staffTimeLogSchema);
