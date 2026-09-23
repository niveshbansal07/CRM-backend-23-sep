const mongoose = require("mongoose");
const {
  cleanString,
  normalizeName,
  normalizeCode,
  slugify,
} = require("../utils/normalize");

const departmentSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
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

    slug: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      index: true,
    },

    code: {
      type: String,
      default: "",
      uppercase: true,
      trim: true,
    },

    headDesignationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      default: null,
    },

    totalEmployees: {
      type: Number,
      default: 0,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    allowedRoles: {
      type: [String],
      default: ["employee"],
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
      index: true,
    },

    source: {
      type: String,
      enum: ["default", "custom"],
      default: "custom",
      index: true,
    },

    isDefaultSeed: {
      type: Boolean,
      default: false,
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

    isSystemDefault: {
      type: Boolean,
      default: false,
    },

    archivedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    lastModifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

departmentSchema.pre("validate", function (next) {
  this.name = cleanString(this.name);
  this.normalizedName = this.normalizedName || normalizeName(this.name);
  this.normalizedName = normalizeName(this.normalizedName);
  this.slug = this.slug || slugify(this.name);
  this.slug = slugify(this.slug || this.name);
  this.code = normalizeCode(this.code);

  if (this.isArchived) {
    this.status = "inactive";
    this.isActive = false;
  } else if (this.status === "inactive") {
    this.isActive = false;
  } else {
    this.status = "active";
    this.isActive = true;
  }

  next();
});

departmentSchema.index(
  { companyId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
departmentSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, sparse: true }
);
departmentSchema.index({ companyId: 1, status: 1, deletedAt: 1 });
departmentSchema.index({ companyId: 1, slug: 1, deletedAt: 1 });
departmentSchema.index({ companyId: 1, isArchived: 1, isActive: 1 });

module.exports = mongoose.model("Department", departmentSchema);
