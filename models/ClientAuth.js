const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");
const crypto   = require("crypto");

const clientAuthSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, unique: true },
    email:    { type: String, trim: true, lowercase: true },
    mobile:   { type: String, trim: true },
    password: { type: String, default: null }, // null = OTP-only login
    isActive: { type: Boolean, default: true },

    // OTP fields
    otp:        { type: String, default: null },
    otpExpiry:  { type: Date,   default: null },
    otpType:    { type: String, enum: ["email","mobile"], default: "email" },

    // Session tracking
    lastLogin:  { type: Date, default: null },
    loginCount: { type: Number, default: 0 },

    // Portal preferences
    notifyOnApproval:  { type: Boolean, default: true },
    notifyOnInvoice:   { type: Boolean, default: true },
    notifyOnShoot:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Hash password before save
clientAuthSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

clientAuthSchema.methods.comparePassword = async function (candidate) {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

// Generate OTP
clientAuthSchema.methods.generateOTP = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
  this.otp       = otp;
  this.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
  return otp;
};

clientAuthSchema.methods.verifyOTP = function (inputOtp) {
  if (!this.otp || !this.otpExpiry) return false;
  if (new Date() > this.otpExpiry) return false;
  return this.otp === inputOtp;
};

module.exports = mongoose.model("ClientAuth", clientAuthSchema);
