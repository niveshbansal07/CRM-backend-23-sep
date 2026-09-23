const mongoose = require("mongoose");
const {
  cleanString,
  normalizeName,
  normalizeCode,
  slugify,
} = require("../utils/normalize");

const designationSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },

    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    title: {
      type: String,
      default: "",
      trim: true,
    },

    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    normalizedTitle: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      index: true,
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

    description: {
      type: String,
      default: "",
      trim: true,
    },

    mappedRole: {
      type: String,
      default: "",
      trim: true,
    },

    allowedRoles: {
      type: [String],
      default: [],
    },

    hierarchyLevel: {
      type: Number,
      required: true,
      min: 1,
      max: 6,
      index: true,
    },

    allowedParentLevels: {
      type: [Number],
      default: [],
    },

    allowedParentDesignations: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
    }],

    canManagePeople: {
      type: Boolean,
      default: false,
    },

    isLeadership: {
      type: Boolean,
      default: false,
    },

    isDepartmentHead: {
      type: Boolean,
      default: false,
      index: true,
    },

    isHead: {
      type: Boolean,
      default: false,
      index: true,
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

    archivedAt: {
      type: Date,
      default: null,
    },

    replacedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
      default: null,
    },

    totalHolders: {
      type: Number,
      default: 0,
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

designationSchema.pre("validate", function (next) {
  const title = cleanString(this.title || this.name);
  this.title = title;
  this.name = cleanString(this.name || title);
  this.normalizedTitle = normalizeName(this.normalizedTitle || title);
  this.normalizedName = normalizeName(this.normalizedName || title);
  this.slug = slugify(this.slug || title);
  this.code = normalizeCode(this.code);
  this.allowedParentLevels = [...new Set(
    (this.allowedParentLevels || [])
      .map((level) => Number(level))
      .filter((level) => Number.isInteger(level) && level >= 1 && level <= 6)
  )];

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

designationSchema.index(
  { companyId: 1, departmentId: 1, normalizedName: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
designationSchema.index({ companyId: 1, departmentId: 1, status: 1, deletedAt: 1 });
designationSchema.index({ companyId: 1, departmentId: 1, hierarchyLevel: 1 });
designationSchema.index(
  { companyId: 1, departmentId: 1, normalizedTitle: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      normalizedTitle: { $type: "string", $gt: "" },
    },
  }
);
designationSchema.index({ companyId: 1, departmentId: 1, isArchived: 1, isActive: 1 });

module.exports = mongoose.model("Designation", designationSchema);
