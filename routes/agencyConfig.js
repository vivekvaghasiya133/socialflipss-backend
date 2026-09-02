const express = require("express");
const router  = express.Router();
const AgencyConfig = require("../models/AgencyConfig");
const { protect }   = require("../middleware/auth");

// Helper to get or initialize config
const getOrCreateConfig = async () => {
  let config = await AgencyConfig.findOne();
  if (!config) {
    config = new AgencyConfig({
      agencyName: "SocialFlipss",
      tagline: "Creative Media & Production Agency",
      primaryColor: "#6366F1",
      servicesMaster: [
        {
          name: "Standard Retainer",
          category: "SMM",
          monthlyFee: 35000,
          description: "Monthly basic branding & social media management.",
          deliverables: { reelsCount: 15, shootsCount: 2, carouselsCount: 5, storiesCount: 15 },
          isActive: true,
        },
        {
          name: "Growth Master (30 Reels)",
          category: "SMM",
          monthlyFee: 55000,
          description: "Aggressive organic growth with daily video content.",
          deliverables: { reelsCount: 30, shootsCount: 4, carouselsCount: 10, storiesCount: 30 },
          isActive: true,
        },
        {
          name: "Video Editing Only",
          category: "Editing",
          monthlyFee: 25000,
          description: "Raw footage editing and color grading package.",
          deliverables: { reelsCount: 30, shootsCount: 0, carouselsCount: 0, storiesCount: 0 },
          isActive: true,
        },
      ],
      rolesPermissions: [
        {
          roleKey: "admin",
          roleName: "Super Admin / Founder",
          canViewInvoices: true,
          canManageClients: true,
          canAssignTasks: true,
          canEditProduction: true,
          canViewFinances: true,
          canManageStaff: true,
          canAccessAllShoots: true,
        },
        {
          roleKey: "manager",
          roleName: "Operations Manager",
          canViewInvoices: false,
          canManageClients: true,
          canAssignTasks: true,
          canEditProduction: true,
          canViewFinances: false,
          canManageStaff: true,
          canAccessAllShoots: true,
        },
        {
          roleKey: "editor",
          roleName: "Video Editor",
          canViewInvoices: false,
          canManageClients: false,
          canAssignTasks: false,
          canEditProduction: true,
          canViewFinances: false,
          canManageStaff: false,
          canAccessAllShoots: false,
        },
        {
          roleKey: "shooter",
          roleName: "Videographer / Shooter",
          canViewInvoices: false,
          canManageClients: false,
          canAssignTasks: false,
          canEditProduction: true,
          canViewFinances: false,
          canManageStaff: false,
          canAccessAllShoots: true,
        },
      ],
      whatsAppTemplates: [
        {
          key: "shoot_schedule",
          title: "Shoot Confirmation to Client",
          text: "Hello {client_name}! Your shoot is confirmed for {shoot_date} at {shoot_time}. Location: {location}. Target: {reels_count} Reels.",
        },
        {
          key: "editing_ready",
          title: "Footage Ready for Editor",
          text: "Hi {editor_name}, new raw footage assigned for {client_name} ({reels_count} reels). Drive link: {drive_link}",
        },
        {
          key: "reel_delivered",
          title: "Reel Delivered to Client",
          text: "Namaste {client_name}! Your new reel is ready for review. Check here: {preview_link}. Monthly Progress: {delivered_count}/{total_quota} Reels Done! 🎉",
        },
      ],
    });
    await config.save();
  }
  return config;
};

// ── 1. GET FULL CONFIG ──
router.get("/", async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    res.json({ success: true, config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 2. UPDATE BRANDING & WHITE-LABEL SETTINGS ──
router.put("/branding", protect, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    const fields = ["agencyName", "tagline", "logoUrl", "primaryColor", "contactMobile", "contactEmail", "address", "gstNumber"];
    fields.forEach(f => {
      if (req.body[f] !== undefined) config[f] = req.body[f];
    });
    await config.save();
    res.json({ success: true, message: "Branding updated successfully!", config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 3. ADD SERVICE PACKAGE ──
router.post("/services", protect, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    config.servicesMaster.push(req.body);
    await config.save();
    res.json({ success: true, message: "New service package created!", config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 4. UPDATE SERVICE PACKAGE ──
router.put("/services/:id", protect, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    const pkg = config.servicesMaster.id(req.params.id);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found" });

    Object.assign(pkg, req.body);
    await config.save();
    res.json({ success: true, message: "Service package updated!", config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 5. DELETE SERVICE PACKAGE ──
router.delete("/services/:id", protect, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    config.servicesMaster.pull(req.params.id);
    await config.save();
    res.json({ success: true, message: "Package removed!", config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 6. UPDATE ROLES & PERMISSIONS MATRIX ──
router.put("/roles", protect, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    if (Array.isArray(req.body.rolesPermissions)) {
      config.rolesPermissions = req.body.rolesPermissions;
      await config.save();
    }
    res.json({ success: true, message: "Roles & permissions updated successfully!", config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 7. UPDATE WHATSAPP TEMPLATES ──
router.put("/whatsapp-templates", protect, async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    if (Array.isArray(req.body.whatsAppTemplates)) {
      config.whatsAppTemplates = req.body.whatsAppTemplates;
      await config.save();
    }
    res.json({ success: true, message: "WhatsApp templates saved!", config });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
