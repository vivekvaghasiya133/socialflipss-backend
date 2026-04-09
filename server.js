const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

console.log("STEP 1");

const authRoutes = require("./routes/auth");
console.log("STEP 2");

const clientRoutes = require("./routes/clients");
console.log("STEP 3");

const seedAdmin = require("./middleware/seedAdmin");
console.log("STEP 4");
const app = express();
console.log("🚀 Server file loaded");
console.log("ENV CHECK:", process.env.MONGO_URI ? "OK" : "MISSING");

// Middleware

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://socialflipsswork.vercel.app"
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/clients", clientRoutes);

// Health check
app.get("/api/health", (req, res) => res.json({ status: "SocialFlipss API running ✓" }));

// Connect MongoDB & start server
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✓ MongoDB connected");
    await seedAdmin(); // Create default admin on first run
    app.listen(process.env.PORT || 5000, () => {
      console.log(`✓ Server running on port ${process.env.PORT || 5000}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });
