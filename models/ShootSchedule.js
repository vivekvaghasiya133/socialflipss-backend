const mongoose = require("mongoose");

const shootSlotSchema = new mongoose.Schema({
  date:        { type: String, required: true },   // "YYYY-MM-DD"
  timeSlot:    { type: String, enum: ["morning","afternoon","evening"], default: "morning" },
  time:        { type: String, default: "10:00 AM" }, // display time
  contentIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: "Content" }], // reels assigned to this slot
  reelCount:   { type: Number, default: 1 },
  status:      { type: String, enum: ["scheduled","done","cancelled","rescheduled"], default: "scheduled" },
  note:        { type: String, default: "" },
  whatsappSent:{ type: Boolean, default: false },
}, { _id: true });

const shootScheduleSchema = new mongoose.Schema(
  {
    projectId:  { type: mongoose.Schema.Types.ObjectId, ref: "Project",  required: true },
    clientId:   { type: mongoose.Schema.Types.ObjectId, ref: "Client",   required: true },

    // Config
    totalReels:    { type: Number, required: true },
    startDate:     { type: String, required: true }, // "YYYY-MM-DD"
    endDate:       { type: String, required: true },
    maxPerDay:     { type: Number, default: 2 },     // admin can override
    workDays:      { type: [Number], default: [1,2,3,4,5,6] }, // 0=Sun,1=Mon...6=Sat

    // Time slot distribution
    preferredSlots: { type: [String], default: ["morning","afternoon","evening"] },

    // Generated slots
    slots: [shootSlotSchema],

    // Stats
    totalScheduled: { type: Number, default: 0 },
    totalDone:      { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShootSchedule", shootScheduleSchema);
