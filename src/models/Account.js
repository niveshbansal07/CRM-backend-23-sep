const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: "", trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
    country: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const accountSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    normalizedName: { type: String, required: true, trim: true, lowercase: true, index: true },
    accountType: { type: String, default: "customer", trim: true, index: true },
    accountTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    distributorBusinessId: { type: String, default: null, trim: true, uppercase: true },
    industry: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    domain: { type: String, default: "", trim: true, lowercase: true, index: true },
    email: { type: String, default: "", trim: true, lowercase: true },
    phone: { type: String, default: "", trim: true },
    ownerName: { type: String, default: "", trim: true },
    gstNumber: { type: String, default: "", trim: true, uppercase: true },
    panNumber: { type: String, default: "", trim: true, uppercase: true },
    address: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    country: { type: String, default: "India", trim: true },
    pincode: { type: String, default: "", trim: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    expectedVisitFrequencyDays: { type: Number, default: null, min: 0 },
    billingAddress: { type: addressSchema, default: () => ({}) },
    serviceAddress: { type: addressSchema, default: () => ({}) },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reportingManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    parentAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    parentRelationshipType: {
      type: String,
      enum: ["distributor", "dealer", "retailer", "parent_company", "channel_partner", null],
      default: null,
    },
    territory: { type: String, default: "", trim: true },
    creditLimit: { type: Number, default: 0, min: 0 },
    paymentTerms: { type: String, default: "", trim: true, maxlength: 200 },
    appointmentDate: { type: Date, default: null },
    outstandingBalance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "prospect", "customer", "partner"],
      default: "prospect",
      index: true,
    },
    onboardingRequired: { type: Boolean, default: false, index: true },
    onboardingStartedAt: { type: Date, default: null },
    sourceLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    convertedFromLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    convertedAt: { type: Date, default: null },
    source: { type: String, default: "Other", trim: true },
    tags: { type: [String], default: [] },
    customValues: { type: Object, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

accountSchema.pre("validate", function (next) {
  if (
    !this.isNew &&
    this.isModified("distributorBusinessId") &&
    this.$locals?.allowDistributorBusinessIdInitialization !== true
  ) {
    this.invalidate("distributorBusinessId", "Distributor business ID is immutable");
  }
  this.normalizedName = String(this.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  this.domain = String(this.domain || "").trim().toLowerCase();
  this.tags = [...new Set((this.tags || []).map((item) => String(item).trim()).filter(Boolean))];
  next();
});

accountSchema.index({ companyId: 1, normalizedName: 1, deletedAt: 1 });
accountSchema.index({ companyId: 1, assignedTo: 1, status: 1, deletedAt: 1 });
accountSchema.index({ companyId: 1, accountTypeId: 1, status: 1 });
accountSchema.index({ companyId: 1, parentAccountId: 1 });
accountSchema.index({ companyId: 1, accountTypeId: 1, parentAccountId: 1, status: 1 });
accountSchema.index({ companyId: 1, assignedTo: 1, status: 1 });
accountSchema.index(
  { companyId: 1, distributorBusinessId: 1 },
  {
    unique: true,
    partialFilterExpression: { distributorBusinessId: { $type: "string" } },
    name: "uniq_company_distributor_business_id",
  }
);

module.exports = mongoose.model("Account", accountSchema);
