const express    = require("express");
const jwt        = require("jsonwebtoken");
const ClientAuth = require("../models/ClientAuth");
const Client     = require("../models/Client");
const { sendOTPEmail } = require("../utils/mailer");
const { protectClient } = require("../middleware/clientAuth");

const router = express.Router();

// ── Helper: generate JWT for client ──────────────────────────────
function generateClientToken(authId, clientId) {
  return jwt.sign(
    { authId, clientId },
    process.env.JWT_SECRET + "_client",
    { expiresIn: "30d" }
  );
}

// POST /api/portal/auth/setup — admin creates portal access for client
router.post("/setup", async (req, res) => {
  try {
    const { clientId, email, mobile, password } = req.body;
    const client = await Client.findById(clientId);
    if (!client) return res.status(404).json({ message: "Client not found" });

    const existing = await ClientAuth.findOne({ clientId });
    if (existing) {
      // Update
      if (email)    existing.email    = email;
      if (mobile)   existing.mobile   = mobile;
      if (password) existing.password = password;
      await existing.save();
      return res.json({ message: "Portal access updated", authId: existing._id });
    }

    const auth = await ClientAuth.create({ clientId, email, mobile, password: password || null });
    res.status(201).json({ message: "Portal access created", authId: auth._id });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /api/portal/auth/login — email + password login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password required" });

    const auth = await ClientAuth.findOne({ email: email.toLowerCase() });
    if (!auth || !auth.isActive) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await auth.comparePassword(password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    auth.lastLogin  = new Date();
    auth.loginCount += 1;
    await auth.save();

    const client = await Client.findById(auth.clientId).select("businessName ownerName status industry");
    const token  = generateClientToken(auth._id, auth.clientId);

    res.json({ token, client: { ...client.toObject(), authId: auth._id } });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/portal/auth/otp/send — send OTP to email or mobile
router.post("/otp/send", async (req, res) => {
  try {
    const { email, mobile } = req.body;

    let auth;
    if (email)  auth = await ClientAuth.findOne({ email:  email.toLowerCase() });
    if (mobile) auth = await ClientAuth.findOne({ mobile: mobile });

    if (!auth || !auth.isActive)
      return res.status(404).json({ message: "No portal access found. Contact SocialFlipss." });

    const otp = auth.generateOTP();
    auth.otpType = email ? "email" : "mobile";
    await auth.save();

    if (email) {
      const client = await Client.findById(auth.clientId).select("ownerName");
      await sendOTPEmail({ email, name: client?.ownerName || "Client", otp });
      res.json({ message: `OTP sent to ${email.replace(/(.{2}).*(@.*)/, "$1***$2")}` });
    } else {
      // SMS — for now just return OTP in dev (integrate SMS provider later)
      console.log(`SMS OTP for ${mobile}: ${otp}`);
      res.json({ message: `OTP sent to ${mobile.slice(0,4)}****${mobile.slice(-2)}`, devOtp: process.env.NODE_ENV === "development" ? otp : undefined });
    }
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/portal/auth/otp/verify — verify OTP and login
router.post("/otp/verify", async (req, res) => {
  try {
    const { email, mobile, otp } = req.body;

    let auth;
    if (email)  auth = await ClientAuth.findOne({ email:  email?.toLowerCase() });
    if (mobile) auth = await ClientAuth.findOne({ mobile: mobile });

    if (!auth) return res.status(404).json({ message: "Auth not found" });

    const valid = auth.verifyOTP(otp);
    if (!valid) return res.status(400).json({ message: "Invalid or expired OTP" });

    // Clear OTP
    auth.otp       = null;
    auth.otpExpiry = null;
    auth.lastLogin  = new Date();
    auth.loginCount += 1;
    await auth.save();

    const client = await Client.findById(auth.clientId).select("businessName ownerName status industry");
    const token  = generateClientToken(auth._id, auth.clientId);

    res.json({ token, client: { ...client.toObject(), authId: auth._id } });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/portal/auth/me
router.get("/me", protectClient, async (req, res) => {
  const client = await Client.findById(req.clientAuth.clientId)
    .select("businessName ownerName mobile email city industry status package instagramPage");
  res.json({ client, auth: { email: req.clientAuth.email, mobile: req.clientAuth.mobile } });
});

// PUT /api/portal/auth/change-password
router.put("/change-password", protectClient, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const ok = await req.clientAuth.comparePassword(currentPassword);
    if (!ok) return res.status(400).json({ message: "Current password wrong" });
    req.clientAuth.password = newPassword;
    await req.clientAuth.save();
    res.json({ message: "Password changed" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
