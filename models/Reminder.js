const mongoose = require("mongoose");

const reminderSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true },
    description: { type: String, default: "" },
    type: {
      type: String,
      enum: ["follow_up", "payment", "content", "meeting", "other"],
      default: "other",
    },
    dueDate:  { type: Date, required: true },
    done:     { type: Boolean, default: false },
    doneAt:   { type: Date, default: null },

    // Links to entities
    leadId:    { type: mongoose.Schema.Types.ObjectId, ref: "Lead",    default: null },
    clientId:  { type: mongoose.Schema.Types.ObjectId, ref: "Client",  default: null },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // WhatsApp message template (for payment reminders)
    whatsappMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Reminder", reminderSchema);
