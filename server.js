const express    = require("express");
const mongoose   = require("mongoose");
const cors       = require("cors");
require("dotenv").config();

const authRoutes       = require("./routes/auth");
const clientRoutes     = require("./routes/clients");
const invoiceRoutes    = require("./routes/invoices");
const staffRoutes      = require("./routes/staff");
const attendanceRoutes = require("./routes/attendance");
const leaveRoutes      = require("./routes/leaves");
const leadRoutes       = require("./routes/leads");
const projectRoutes    = require("./routes/projects");
const contentRoutes    = require("./routes/content");
const worklogRoutes    = require("./routes/worklogs");
const reminderRoutes   = require("./routes/reminders");
const analyticsRoutes  = require("./routes/analytics");
const seedAdmin        = require("./middleware/seedAdmin");

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "https://socialflipsswork.vercel.app"
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
app.use(express.json());

app.use("/api/auth",       authRoutes);
app.use("/api/clients",    clientRoutes);
app.use("/api/invoices",   invoiceRoutes);
app.use("/api/staff",      staffRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leaves",     leaveRoutes);
app.use("/api/leads",      leadRoutes);
app.use("/api/projects",   projectRoutes);
app.use("/api/content",    contentRoutes);
app.use("/api/worklogs",   worklogRoutes);
app.use("/api/reminders",  reminderRoutes);
app.use("/api/analytics",  analyticsRoutes);

app.get("/api/health", (req, res) =>
  res.json({ status:"SocialFlipss API ✓", version:"1.0.0", timestamp: new Date() })
);

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✓ MongoDB connected");
    await seedAdmin();
    app.listen(process.env.PORT || 5000, () =>
      console.log(`✓ Server running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error("MongoDB error:", err); process.exit(1); });
