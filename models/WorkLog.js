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
    videosEdited:   { type: Number, default: 0 },
    postsDesigned:  { type: Number, default: 0 },
    hoursWorked:    { type: Number, default: 0 },

    items: [
      {
        name: { type: String, required: true },
        videosCreated: { type: Number, default: 0 },
        videosEdited: { type: Number, default: 0 },
      }
    ],

    // Link to content item if applicable
    contentId: { type: mongoose.Schema.Types.ObjectId, ref: "Content", default: null },

    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

workLogSchema.pre("save", function (next) {
  if (this.items && this.items.length > 0) {
    this.videosCreated = this.items.reduce((sum, item) => sum + (item.videosCreated || 0), 0);
    this.videosEdited  = this.items.reduce((sum, item) => sum + (item.videosEdited || 0), 0);
  }
  next();
});

// One log per user per date per workType (upsert friendly)
workLogSchema.index({ userId: 1, date: 1, workType: 1 });

module.exports = mongoose.model("WorkLog", workLogSchema);
