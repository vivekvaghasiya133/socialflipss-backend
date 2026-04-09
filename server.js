const express    = require("express");
const mongoose   = require("mongoose");
const cors       = require("cors");
require("dotenv").config();

const authRoutes       = require("./routes/auth");
const clientRoutes     = require("./routes/clients");
const staffRoutes      = require("./routes/staff");
const attendanceRoutes = require("./routes/attendance");
const leaveRoutes      = require("./routes/leaves");
const seedAdmin        = require("./middleware/seedAdmin");

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3000", credentials: true }));
app.use(express.json());

app.use("/api/auth",       authRoutes);
app.use("/api/clients",    clientRoutes);
app.use("/api/staff",      staffRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leaves",     leaveRoutes);

app.get("/api/health", (req, res) => res.json({ status: "SocialFlipss API ✓" }));

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✓ MongoDB connected");
    await seedAdmin();
    app.listen(process.env.PORT || 5000, () =>
      console.log(`✓ Server on port ${process.env.PORT || 5000}`)
    );
  })
  .catch((err) => { console.error("MongoDB error:", err); process.exit(1); });
