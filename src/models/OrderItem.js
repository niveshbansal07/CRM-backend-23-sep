const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");

const orderItemSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    parentType: { type: String, enum: ["deal", "order", "quote"], required: true, index: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    materialNumberSnapshot: { type: String, default: "", trim: true },
    productNameSnapshot: { type: String, default: "", trim: true },
    quantity: { type: Number, required: true, min: 1 },
    uom: { type: String, default: "", trim: true },
    basePriceSnapshot: { type: Number, default: 0, min: 0 },
    negotiatedUnitPrice: { type: Number, default: 0, min: 0 },
    discountTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    lineSubtotal: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0, min: 0 },
    priceChangeReason: { type: String, default: "", trim: true },
    approvalStatus: {
      type: String,
      enum: ["not_required", "pending", "approved", "rejected"],
      default: "not_required",
      index: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const getDiscountMode = async (doc) => {
  if (!doc.discountTypeId || !mongoose.Types.ObjectId.isValid(String(doc.discountTypeId))) {
    return "none";
  }

  const CrmMaster = require("./CrmMaster");
  const master = await CrmMaster.findOne({
    _id: doc.discountTypeId,
    companyId: doc.companyId,
    module: "order",
    type: "discount_type",
  })
    .select("name code")
    .lean();

  const value = `${master?.code || ""} ${master?.name || ""}`.toLowerCase();
  if (value.includes("percentage")) return "percentage";
  if (value.includes("fixed")) return "fixed";
  return "none";
};

orderItemSchema.pre("save", async function (next) {
  try {
    if (this.negotiatedUnitPrice < this.basePriceSnapshot && !this.priceChangeReason) {
      throw new ApiError(400, "Price change reason required when negotiating below base price");
    }

    const discountMode = await getDiscountMode(this);
    this.lineSubtotal = roundMoney(this.quantity * this.negotiatedUnitPrice);
    if (discountMode === "percentage") {
      this.discountAmount = roundMoney(this.lineSubtotal * (this.discountValue / 100));
    } else if (discountMode === "fixed") {
      this.discountAmount = roundMoney(this.discountValue);
    } else {
      this.discountAmount = 0;
    }
    this.discountAmount = Math.min(this.discountAmount, this.lineSubtotal);

    const taxableAmount = Math.max(0, this.lineSubtotal - this.discountAmount);
    this.taxAmount = roundMoney(taxableAmount * (this.taxRate / 100));
    this.lineTotal = roundMoney(taxableAmount + this.taxAmount);
    next();
  } catch (error) {
    next(error);
  }
});

orderItemSchema.index({ companyId: 1, parentType: 1, parentId: 1 });
orderItemSchema.index({ companyId: 1, productId: 1 });
orderItemSchema.index({ companyId: 1, approvalStatus: 1 });

module.exports = mongoose.model("OrderItem", orderItemSchema);
