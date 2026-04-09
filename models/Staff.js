const mongoose = require("mongoose");
const crypto   = require("crypto");

const staffSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    email:       { type: String, trim: true, lowercase: true },
    mobile:      { type: String, trim: true },
    position:    { type: String, required: true, trim: true },
    department:  { type: String, trim: true },
    joiningDate: { type: Date, default: Date.now },
    salary:      { type: Number, required: true },
    status:      { type: String, enum: ["active","inactive"], default: "active" },
    // Unique token — staff gets personal leave form link, no login needed
    leaveToken:  {
      type:    String,
      default: () => crypto.randomBytes(20).toString("hex"),
      unique:  true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Staff", staffSchema);
