const mongoose = require("mongoose");

const meetingSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    title: { type: String, required: true },
    purpose: { type: String, required: true },
    date: { type: Date, required: true, default: Date.now },
    notes: { type: String, default: "" },
    images: { type: [String], default: [] }, // Array of uploaded image URLs
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Meeting", meetingSchema);
