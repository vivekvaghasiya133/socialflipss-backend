const mongoose = require("mongoose");

// Each follow-up / interaction log
const activitySchema = new mongoose.Schema({
  type:    { type: String, enum: ["call", "meeting", "whatsapp", "email", "note"], required: true },
  note:    { type: String, required: true },
  date:    { type: Date, default: Date.now },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { _id: true });

const leadSchema = new mongoose.Schema(
  {
    // Basic info
    businessName: { type: String, required: true, trim: true },
    contactName:  { type: String, required: true, trim: true },
    mobile:       { type: String, required: true, trim: true },
    email:        { type: String, trim: true, lowercase: true },
    city:         { type: String, trim: true },
    industry:     { type: String, trim: true },
    source:       {
      type: String,
      enum: ["instagram", "facebook", "referral", "google", "walk_in", "cold_call", "other"],
      default: "other",
    },

    // Lead status
    status: {
      type: String,
      enum: ["new", "follow_up", "converted", "not_interested"],
      default: "new",
    },

    // Services interested in
    interestedServices: [{ type: String }],
    budget:             { type: String, default: "" }, // rough budget range
    notes:              { type: String, default: "" }, // initial notes

    // Follow-up scheduling
    nextFollowUp: { type: Date, default: null },

    // Last communication summary (quick reference)
    lastCommunication: { type: String, default: "" },
    lastContactDate:   { type: Date, default: null },

    // Assignment
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Activity log (calls, meetings, notes)
    activities: [activitySchema],

    // If converted — link to client
    convertedToClient: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },

    // Added by
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Lead", leadSchema);
