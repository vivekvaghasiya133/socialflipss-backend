const express    = require("express");
const mongoose   = require("mongoose");
const cors       = require("cors");
const path       = require("path");
require("dotenv").config();
const meetingRoutes = require("./routes/meetings");

// Existing routes
const authRoutes          = require("./routes/auth");
const clientRoutes        = require("./routes/clients");
const invoiceRoutes       = require("./routes/invoices");
const staffRoutes         = require("./routes/staff");
const attendanceRoutes    = require("./routes/attendance");
const leaveRoutes         = require("./routes/leaves");
const leadRoutes          = require("./routes/leads");
const projectRoutes       = require("./routes/projects");
const contentRoutes       = require("./routes/content");
const worklogRoutes       = require("./routes/worklogs");
const reminderRoutes      = require("./routes/reminders");
const analyticsRoutes     = require("./routes/analytics");
const shootScheduleRoutes = require("./routes/shootSchedule");

// Phase 5 — NEW
const portalAuthRoutes    = require("./routes/portalAuth");
const portalDataRoutes    = require("./routes/portalData");
const autoInvoiceRoutes   = require("./routes/autoInvoice");
const notificationRoutes  = require("./routes/notifications");
const hisabRoutes         = require("./routes/hisab");
const strategyRoutes      = require("./routes/strategies");
const contentAnalyticsRoutes = require("./routes/contentAnalytics");
const runStagesMigration   = require("./utils/migration");

const seedAdmin = require("./middleware/seedAdmin");

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://socialflipsswork.vercel.app",
  "https://www.socialflipss.com",
  "https://socialflipss.com"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ── Existing API ──────────────────────────────────────────────────
app.use("/api/auth",           authRoutes);
app.use("/api/clients",        clientRoutes);
app.use("/api/invoices",       invoiceRoutes);
app.use("/api/staff",          staffRoutes);
app.use("/api/attendance",     attendanceRoutes);
app.use("/api/leaves",         leaveRoutes);
app.use("/api/leads",          leadRoutes);
app.use("/api/projects",       projectRoutes);
app.use("/api/content",        contentRoutes);
app.use("/api/worklogs",       worklogRoutes);
app.use("/api/reminders",      reminderRoutes);
app.use("/api/analytics",      analyticsRoutes);
app.use("/api/shoot-schedule", shootScheduleRoutes);

// ── Phase 5 — NEW ─────────────────────────────────────────────────
app.use("/api/portal/auth",    portalAuthRoutes);   // client login/OTP
app.use("/api/portal",         portalDataRoutes);   // client portal data
app.use("/api/auto-invoice",   autoInvoiceRoutes);  // auto invoice + reminders
app.use("/api/notifications",  notificationRoutes); // admin notifications
app.use("/api/hisab",          hisabRoutes);
app.use("/api/strategies",        strategyRoutes);
app.use("/api/content-analytics", contentAnalyticsRoutes);
app.use("/api/meetings",          meetingRoutes);

app.get("/api/health", (req, res) =>
  res.json({ status:"SocialFlipss API ✓", version:"3.0.0", timestamp: new Date() })
);

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✓ MongoDB connected");
    await seedAdmin();
    await runStagesMigration();
    app.listen(process.env.PORT || 5000, () =>
      console.log(`✓ Server on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error("MongoDB error:", err); process.exit(1); });
