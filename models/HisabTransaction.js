const mongoose = require("mongoose");

const hisabTransactionSchema = new mongoose.Schema({
  type:   { type: String, enum: ["draw", "settle"], required: true },
  person: { type: String, required: true }, // lowercase, e.g. "vivek", "kuldeep" or custom
  amount: { type: Number, required: true },
  date:   { type: Date, default: Date.now },
  note:   { type: String, default: "" },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("HisabTransaction", hisabTransactionSchema);
