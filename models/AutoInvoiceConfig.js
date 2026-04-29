const mongoose = require("mongoose");

const autoInvoiceConfigSchema = new mongoose.Schema(
  {
    clientId:      { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, unique: true },
    enabled:       { type: Boolean, default: true },

    // Generate on: onboarding anniversary each month
    // e.g. if onboarding was 15th → invoice on 15th every month
    dayOfMonth:    { type: Number, default: null }, // auto-set from onboarding date

    // Invoice template
    packageName:   { type: String, default: "" },
    packageAmount: { type: Number, default: 0 },
    gstPercent:    { type: Number, default: 0 },
    extraItems:    [{ description: String, amount: Number }],
    notes:         { type: String, default: "" },

    // Reminder schedule (days after invoice generation)
    reminders: {
      day5:  { type: Boolean, default: true },   // 5 days after if unpaid
      day10: { type: Boolean, default: true },   // 10 days after if unpaid
      day15: { type: Boolean, default: true },   // 15 days after if unpaid
    },

    // Tracking
    lastGeneratedMonth: { type: String, default: "" },  // "2026-04"
    lastGeneratedAt:    { type: Date,   default: null },
    totalGenerated:     { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AutoInvoiceConfig", autoInvoiceConfigSchema);
