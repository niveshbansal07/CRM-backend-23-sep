const mongoose = require("mongoose");

const stageHistorySchema = new mongoose.Schema(
  {
    stageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    stage: { type: String, required: true },
    fromStage: { type: String, default: "" },
    toStage: { type: String, default: "" },
    note: { type: String, default: "", trim: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    changedAt: { type: Date, default: Date.now },
    enteredAt: { type: Date, default: Date.now },
    exitedAt: { type: Date, default: null },
    daysInStage: { type: Number, min: 0, default: 0 },
  },
  { _id: false }
);

const lineItemSchema = new mongoose.Schema(
  {
    orderItemId: { type: mongoose.Schema.Types.ObjectId, ref: "OrderItem", default: null },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogItem", default: null },
    itemType: { type: String, default: "other", trim: true },
    code: { type: String, default: "", trim: true },
    description: { type: String, required: true, trim: true },
    quantity: { type: Number, min: 0.0001, default: 1 },
    unitPrice: { type: Number, min: 0, default: 0 },
    sellingPrice: { type: Number, min: 0, default: 0 },
    requestedUnitPrice: { type: Number, min: 0, default: 0 },
    discountPercent: { type: Number, min: 0, max: 100, default: 0 },
    maxDiscountPercent: { type: Number, min: 0, max: 100, default: 0 },
    approvalLevel: { type: String, enum: ["none", "sales_manager", "sales_head"], default: "none" },
    taxPercent: { type: Number, min: 0, max: 100, default: 0 },
    subtotal: { type: Number, min: 0, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    total: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    metadata: { type: Object, default: {} },
    priceOverrideReason: { type: String, default: "", trim: true },
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    contentType: { type: String, default: "", trim: true },
    size: { type: Number, min: 0, default: 0 },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const dealSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    contact: { type: String, default: "", trim: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    sourceLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    pipelineId: { type: mongoose.Schema.Types.ObjectId, default: null },
    stageId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    stage: { type: String, required: true, trim: true, index: true },
    value: { type: Number, min: 0, default: 0 },
    subtotal: { type: Number, min: 0, default: 0 },
    discountTotal: { type: Number, min: 0, default: 0 },
    taxTotal: { type: Number, min: 0, default: 0 },
    grandTotal: { type: Number, min: 0, default: 0 },
    discountTotalAmount: { type: Number, min: 0, default: 0 },
    taxTotalAmount: { type: Number, min: 0, default: 0 },
    lineItems: { type: [lineItemSchema], default: [] },
    approvalStatus: {
      type: String,
      enum: ["not_required", "pending_manager", "pending_head", "approved", "rejected"],
      default: "not_required",
      index: true,
    },
    approvalLevel: { type: String, enum: ["none", "sales_manager", "sales_head"], default: "none", index: true },
    approvalReason: { type: String, default: "", trim: true },
    approvalRequestedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    probability: { type: Number, min: 0, max: 100, default: 0 },
    forecastCategory: { type: String, enum: ["pipeline", "best_case", "commit", "closed"], default: "pipeline", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    expectedClose: { type: Date, default: null, index: true },
    closedAt: { type: Date, default: null },
    actualClosingDate: { type: Date, default: null },
    closeReason: { type: String, default: "", trim: true },
    lostReasonId: { type: String, default: "", trim: true },
    nextAction: { type: String, default: "", trim: true },
    nextActionAt: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
    attachments: { type: [attachmentSchema], default: [] },
    customValues: { type: Object, default: {} },
    stageHistory: { type: [stageHistorySchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

dealSchema.pre("save", function (next) {
  const lineItems = this.lineItems || [];
  const subtotal = lineItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const discountTotal = lineItems.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
  const taxTotal = lineItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0);
  const grandTotal = lineItems.reduce((sum, item) => sum + Number(item.total || 0), 0);

  if (lineItems.length > 0) {
    this.subtotal = Math.round(subtotal * 100) / 100;
    this.discountTotal = Math.round(discountTotal * 100) / 100;
    this.taxTotal = Math.round(taxTotal * 100) / 100;
    this.discountTotalAmount = this.discountTotal;
    this.taxTotalAmount = this.taxTotal;
    this.grandTotal = Math.round(grandTotal * 100) / 100;
    this.value = this.grandTotal;
  }

  next();
});

dealSchema.index({ companyId: 1, stage: 1, assignedTo: 1, deletedAt: 1 });
dealSchema.index({ companyId: 1, expectedClose: 1, deletedAt: 1 });

module.exports = mongoose.model("Deal", dealSchema);
