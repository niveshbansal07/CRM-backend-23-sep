const mongoose = require("mongoose");

const productPriceHistorySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    oldPrice: { type: Number, default: 0 },
    newPrice: { type: Number, default: 0 },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    changedAt: { type: Date, default: Date.now },
    reason: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

productPriceHistorySchema.index({ productId: 1, changedAt: -1 });

module.exports = mongoose.model("ProductPriceHistory", productPriceHistorySchema);
