const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const hisabPasswordSchema = new mongoose.Schema({
  password: { type: String, required: true },
}, { timestamps: true });

hisabPasswordSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("HisabPassword", hisabPasswordSchema);
