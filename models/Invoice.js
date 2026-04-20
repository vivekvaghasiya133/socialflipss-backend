const mongoose = require("mongoose");

const invoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  quantity:    { type: Number, default: 1 },
  rate:        { type: Number, required: true },
  amount:      { type: Number, required: true },
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  amount:    { type: Number, required: true },
  date:      { type: Date,   default: Date.now },
  method:    { type: String, enum: ["cash","upi","bank","cheque","other"], default: "upi" },
  note:      { type: String, default: "" },
  addedBy:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { _id: true });

const invoiceSchema = new mongoose.Schema(
  {
    // Invoice number — auto generated
    invoiceNumber: { type: String, required: true, unique: true },

    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },

    // Invoice period
    month:     { type: String, default: "" },          // "April 2026"
    issueDate: { type: Date,   default: Date.now },
    dueDate:   { type: Date,   default: null },

    // Line items
    items: [invoiceItemSchema],

    // Amounts
    subtotal:    { type: Number, default: 0 },
    discount:    { type: Number, default: 0 },          // flat discount
    gstPercent:  { type: Number, default: 0 },          // 0 or 18
    gstAmount:   { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },          // final amount

    // Payment tracking
    paidAmount:    { type: Number, default: 0 },
    pendingAmount: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ["pending", "partial", "paid"],
      default: "pending",
    },

    // Payment records
    payments: [paymentSchema],

    // Notes
    notes:     { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// Auto-update payment status based on amounts
invoiceSchema.pre("save", function (next) {
  this.pendingAmount = Math.max(0, this.totalAmount - this.paidAmount);
  if (this.paidAmount <= 0)                          this.paymentStatus = "pending";
  else if (this.paidAmount >= this.totalAmount)      this.paymentStatus = "paid";
  else                                               this.paymentStatus = "partial";
  next();
});

module.exports = mongoose.model("Invoice", invoiceSchema);
