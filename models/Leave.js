const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema(
  {
    staffId:   { type: mongoose.Schema.Types.ObjectId, ref: "Staff", required: true },
    fromDate:  { type: String, required: true },  // "YYYY-MM-DD"
    toDate:    { type: String, required: true },
    leaveType: { type: String, enum: ["full_day","half_day"], default: "full_day" },
    reason:    { type: String, required: true },
    status:    { type: String, enum: ["pending","approved","rejected"], default: "pending" },
    adminNote: { type: String, default: "" },
    // Track if email was sent
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Leave", leaveSchema);
