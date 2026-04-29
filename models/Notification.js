const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    // Who receives it
    recipientType: { type: String, enum: ["admin", "client"], required: true },
    recipientId:   { type: mongoose.Schema.Types.ObjectId, required: true },
    // admin → User._id, client → Client._id

    // Content
    title:   { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "content_approved","content_rejected","content_changes_requested",
        "invoice_generated","invoice_paid","payment_reminder",
        "shoot_reminder","lead_converted","new_content_uploaded",
        "onboarding_complete","general",
      ],
      default: "general",
    },

    // Status
    read:   { type: Boolean, default: false },
    readAt: { type: Date,    default: null },

    // Links
    link:      { type: String, default: "" },  // frontend route to navigate to
    clientId:  { type: mongoose.Schema.Types.ObjectId, ref: "Client",  default: null },
    contentId: { type: mongoose.Schema.Types.ObjectId, ref: "Content", default: null },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice", default: null },

    // Email tracking
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
