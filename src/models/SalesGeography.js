const mongoose = require("mongoose");
const { cleanString, normalizeName, normalizeCode } = require("../utils/normalize");
const {
  SALES_GEOGRAPHY_TYPES,
  SALES_GEOGRAPHY_PARENT_TYPE,
  normalizeGeographyType,
} = require("../constants/salesGeography");

const salesGeographySchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: SALES_GEOGRAPHY_TYPES,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesGeography",
      default: null,
      index: true,
    },
    stateNames: [{
      type: String,
      trim: true,
    }],
    stateName: {
      type: String,
      default: "",
      trim: true,
    },
    districtName: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

salesGeographySchema.pre("validate", function (next) {
  this.type = normalizeGeographyType(this.type);
  this.name = cleanString(this.name);
  this.normalizedName = normalizeName(this.normalizedName || this.name);
  this.code = normalizeCode(this.code);
  this.description = cleanString(this.description);

  const expectedParentType = SALES_GEOGRAPHY_PARENT_TYPE[this.type];
  if (expectedParentType === null && this.parentId) {
    this.invalidate("parentId", "Zone cannot have a geography parent");
  }
  if (expectedParentType && !this.parentId) {
    this.invalidate("parentId", `${this.type} requires a ${expectedParentType} parent`);
  }

  if (this.isArchived || this.status === "inactive") {
    this.status = "inactive";
    this.isActive = false;
  } else {
    this.status = "active";
    this.isActive = true;
  }

  next();
});

salesGeographySchema.index(
  { companyId: 1, type: 1, parentId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
salesGeographySchema.index(
  { companyId: 1, type: 1, parentId: 1, code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
salesGeographySchema.index({ companyId: 1, type: 1, parentId: 1, status: 1, deletedAt: 1 });
salesGeographySchema.index({ companyId: 1, parentId: 1, status: 1, deletedAt: 1 });
salesGeographySchema.index({ companyId: 1, isArchived: 1, isActive: 1 });

module.exports = mongoose.model("SalesGeography", salesGeographySchema);
