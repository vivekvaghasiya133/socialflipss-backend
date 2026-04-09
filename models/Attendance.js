const mongoose = require("mongoose");

// One document per staff per day
const attendanceSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    date:    { type: String, required: true }, // "YYYY-MM-DD" format — easy to query
    status:  {
      type: String,
      enum: ["present", "absent", "half_day", "holiday", "leave"],
      required: true,
    },
    note:    { type: String, default: "" },    // optional admin note
  },
  { timestamps: true }
);

// Unique: one record per staff per day
attendanceSchema.index({ staffId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
