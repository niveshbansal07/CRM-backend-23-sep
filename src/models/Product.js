const mongoose = require("mongoose");

const imageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },

    materialNumber: { type: String, trim: true, uppercase: true, index: true },
    materialDescription: { type: String, required: true, trim: true, index: true },
    materialTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    industrySector: { type: String, default: "", trim: true },
    baseUnitOfMeasure: { type: String, default: "Piece", trim: true },
    materialGroupId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    divisionId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    images: { type: [imageSchema], default: [] },

    plant: { type: String, default: "", trim: true },
    storageLocation: { type: String, default: "", trim: true },
    warehouseNumber: { type: String, default: "", trim: true },
    storageType: { type: String, default: "", trim: true },
    storageConditions: { type: String, default: "", trim: true },
    shelfLifeDays: { type: Number, default: null, min: 0 },

    purchasingGroupId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    orderUnit: { type: String, default: "", trim: true },
    procurementTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    minOrderQuantity: { type: Number, default: 1, min: 0 },

    mrpTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    mrpController: { type: String, default: "", trim: true },
    lotSize: { type: Number, default: null, min: 0 },
    reorderPoint: { type: Number, default: null, min: 0 },
    availabilityCheck: { type: String, default: "", trim: true },

    salesUnit: { type: String, default: "", trim: true },
    maxDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
    itemCategoryGroup: { type: String, default: "", trim: true },
    taxClassificationId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    taxRate: { type: Number, default: 0, min: 0, max: 100 },

    valuationClass: { type: String, default: "", trim: true },
    priceControlId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    standardPrice: { type: Number, default: 0, min: 0 },
    movingAveragePrice: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR", trim: true, uppercase: true },

    grossWeight: { type: Number, default: null, min: 0 },
    netWeight: { type: Number, default: null, min: 0 },
    weightUnit: { type: String, default: "Kg", trim: true },
    volume: { type: Number, default: null, min: 0 },
    volumeUnit: { type: String, default: "L", trim: true },
    countryOfOriginId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },

    batchManagementEnabled: { type: Boolean, default: false },
    serialNumberProfile: { type: String, default: "", trim: true },

    isActive: { type: Boolean, default: true, index: true },
    stockQuantity: { type: Number, default: 0, min: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

const buildMaterialNumber = (sequence) => `MAT-${String(sequence).padStart(4, "0")}`;

productSchema.pre("validate", function (next) {
  if (this.materialNumber) this.materialNumber = this.materialNumber.trim().toUpperCase();
  if (this.materialDescription) this.materialDescription = this.materialDescription.trim().replace(/\s+/g, " ");
  if (this.currency) this.currency = this.currency.trim().toUpperCase();
  next();
});

productSchema.pre("save", async function (next) {
  try {
    if (this.isNew && !this.materialNumber) {
      const count = await this.constructor.countDocuments({ companyId: this.companyId });
      this.materialNumber = buildMaterialNumber(count + 1);
    }

    if (!this.isNew && this.isModified("standardPrice")) {
      const existing = await this.constructor.findById(this._id).select("standardPrice").lean();
      this.$locals.priceHistory = {
        oldPrice: existing?.standardPrice || 0,
        newPrice: this.standardPrice || 0,
        reason: this.$locals.priceChangeReason || "",
      };
    }

    next();
  } catch (error) {
    next(error);
  }
});

productSchema.post("save", async function (doc, next) {
  try {
    const priceHistory = doc.$locals.priceHistory;
    if (priceHistory && Number(priceHistory.oldPrice) !== Number(priceHistory.newPrice)) {
      const ProductPriceHistory = require("./ProductPriceHistory");
      await ProductPriceHistory.create({
        companyId: doc.companyId,
        productId: doc._id,
        oldPrice: priceHistory.oldPrice,
        newPrice: priceHistory.newPrice,
        changedBy: doc.updatedBy || doc.createdBy || null,
        changedAt: new Date(),
        reason: priceHistory.reason,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
});

productSchema.index({ companyId: 1, materialNumber: 1 }, { unique: true });
productSchema.index({ companyId: 1, materialGroupId: 1, isActive: 1 });
productSchema.index({ companyId: 1, divisionId: 1, isActive: 1 });
productSchema.index({ companyId: 1, materialDescription: "text", materialNumber: "text" });

module.exports = mongoose.model("Product", productSchema);
