const mongoose = require("mongoose");

const workLogSchema = new mongoose.Schema(
  {
    userId:   { type: mongoose.Schema.Types.ObjectId, ref: "User",    required: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client",  default: null },
    projectId:{ type: mongoose.Schema.Types.ObjectId, ref: "Project", default: null },
    date:     { type: String, required: true },  // "YYYY-MM-DD"

    // What work was done
    workType: {
      type: String,
      enum: ["video_editing","shooting","designing","content_writing","seo","ads","meeting","other"],
      required: true,
    },
    description: { type: String, required: true },

    // Output count
    videosCreated:  { type: Number, default: 0 },
    postsDesigned:  { type: Number, default: 0 },
    hoursWorked:    { type: Number, default: 0 },

    // Link to content item if applicable
    contentId: { type: mongoose.Schema.Types.ObjectId, ref: "Content", default: null },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One log per user per date per workType (upsert friendly)
workLogSchema.index({ userId: 1, date: 1, workType: 1 });

module.exports = mongoose.model("WorkLog", workLogSchema);
