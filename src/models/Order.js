const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    orderNumber: { type: String, trim: true, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    sourceLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    sourceDealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", default: null, index: true },
    sourceVisitId: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", default: null, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    orderStatus: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    paymentStatus: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    grandTotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    deliveryAddress: { type: String, default: "", trim: true },
    deliveryDate: { type: Date, default: null },
    notes: { type: String, default: "", trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

const getDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

orderSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.orderNumber) {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const count = await this.constructor.countDocuments({
        companyId: this.companyId,
        createdAt: { $gte: start, $lte: end },
      });
      this.orderNumber = `ORD-${getDateKey(now)}-${String(count + 1).padStart(3, "0")}`;
    }
    next();
  } catch (error) {
    next(error);
  }
});

orderSchema.index({ companyId: 1, orderNumber: 1 }, { unique: true, sparse: true });
orderSchema.index({ companyId: 1, accountId: 1, createdAt: -1 });
orderSchema.index({ companyId: 1, assignedTo: 1, createdAt: -1 });
orderSchema.index({ companyId: 1, orderStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
