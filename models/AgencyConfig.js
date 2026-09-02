const mongoose = require("mongoose");

const servicePackageSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true },
    category:     { type: String, default: "SMM" }, // "SMM", "Production", "Editing", "Ads"
    monthlyFee:   { type: Number, required: true },
    description:  { type: String, default: "" },
    deliverables: {
      reelsCount:     { type: Number, default: 0 },
      shootsCount:    { type: Number, default: 0 },
      carouselsCount: { type: Number, default: 0 },
      storiesCount:   { type: Number, default: 0 },
    },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const rolePermissionSchema = new mongoose.Schema(
  {
    roleKey:            { type: String, required: true }, // "admin", "manager", "editor", "shooter", "writer"
    roleName:           { type: String, required: true },
    canViewInvoices:    { type: Boolean, default: false },
    canManageClients:   { type: Boolean, default: false },
    canAssignTasks:     { type: Boolean, default: false },
    canEditProduction:  { type: Boolean, default: true },
    canViewFinances:    { type: Boolean, default: false },
    canManageStaff:     { type: Boolean, default: false },
    canAccessAllShoots: { type: Boolean, default: false },
  },
  { _id: true }
);

const whatsAppTemplateSchema = new mongoose.Schema(
  {
    key:   { type: String, required: true }, // "shoot_schedule", "editing_ready", "client_delivery"
    title: { type: String, required: true },
    text:  { type: String, required: true },
  },
  { _id: true }
);

const agencyConfigSchema = new mongoose.Schema(
  {
    agencyName:    { type: String, default: "SocialFlipss" },
    tagline:       { type: String, default: "Creative Media & Production Agency" },
    logoUrl:       { type: String, default: "" },
    primaryColor:  { type: String, default: "#6366F1" }, // Indigo / Violet Luxury
    contactMobile: { type: String, default: "919213532835" },
    contactEmail:  { type: String, default: "contact@socialflipss.com" },
    address:       { type: String, default: "Surat, Gujarat, India" },
    gstNumber:     { type: String, default: "" },

    servicesMaster:    [servicePackageSchema],
    rolesPermissions:  [rolePermissionSchema],
    whatsAppTemplates: [whatsAppTemplateSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("AgencyConfig", agencyConfigSchema);
