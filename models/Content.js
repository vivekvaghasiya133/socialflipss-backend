const mongoose = require("mongoose");

// Comment / approval note
const commentSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  addedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const contentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    clientId:  { type: mongoose.Schema.Types.ObjectId, ref: "Client",  required: true },

    // Content info
    title:       { type: String, required: true, trim: true },
    type:        {
      type: String,
      enum: ["reel", "post", "story", "carousel", "youtube", "other"],
      default: "reel",
    },
    description: { type: String, default: "" },  // Caption / concept idea
    platform:    { type: String, default: "instagram" },

    // Pipeline stage
    stage: {
      type: String,
      enum: ["idea", "approved", "shooting", "editing", "posted"],
      default: "idea",
    },

    // Assignment
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // Dates
    shootDate:   { type: Date,   default: null },
    postDate:    { type: Date,   default: null },  // Planned post date
    postedAt:    { type: Date,   default: null },  // Actual post date

    // Links
    driveLink:     { type: String, default: "" },  // Google Drive / raw file
    instagramLink: { type: String, default: "" },  // Posted link
    thumbnailUrl:  { type: String, default: "" },

    // Approval
    clientApproved: { type: Boolean, default: false },
    approvalNote:   { type: String,  default: "" },

    // Comments / notes
    comments: [commentSchema],

    // Priority
    priority: { type: String, enum: ["low","medium","high"], default: "medium" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Content", contentSchema);
