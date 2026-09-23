const mongoose = require("mongoose");

const leadPhotoSchema = new mongoose.Schema(
  {
    url: { type: String, default: "", trim: true },
    name: { type: String, default: "", trim: true },
    mimeType: { type: String, default: "", trim: true },
    capturedAt: { type: Date, default: null },
    source: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const leadLocationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    accuracy: { type: Number, default: null },
    local: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    district: { type: String, default: "", trim: true },
    state: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },
    country: { type: String, default: "", trim: true },
    formattedAddress: { type: String, default: "", trim: true },
    googlePlaceId: { type: String, default: "", trim: true },
    provider: { type: String, default: "", trim: true },
    resolvedAt: { type: Date, default: null },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    companyName: { type: String, default: "", trim: true, index: true },
    contact: { type: String, default: "", trim: true, index: true },
    jobTitle: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true, lowercase: true, index: true },
    normalizedEmail: { type: String, default: "", lowercase: true, index: true },
    phone: { type: String, default: "", trim: true, index: true },
    normalizedPhone: { type: String, default: "", index: true },
    status: { type: String, required: true, trim: true, index: true },
    stageId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    source: { type: String, default: "Other", trim: true, index: true },
    sourceDetail: { type: String, default: "", trim: true },
    utmSource: { type: String, default: "", trim: true, index: true },
    utmMedium: { type: String, default: "", trim: true },
    utmCampaign: { type: String, default: "", trim: true, index: true },
    utmTerm: { type: String, default: "", trim: true },
    utmContent: { type: String, default: "", trim: true },
    referredByContactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null, index: true },
    referredByLeadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    priority: { type: String, enum: ["low", "medium", "high", "urgent", "cold", "warm", "hot"], default: "warm", index: true },
    value: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "INR", uppercase: true, trim: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reportingManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    salesHeadId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null, index: true },
    leadTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadType", default: null, index: true },
    sourceVisitId: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", default: null, index: true },
    creationStartedAt: { type: Date, default: null },
    creationSubmittedAt: { type: Date, default: null },
    creationDurationSeconds: { type: Number, default: 0, min: 0 },
    linkedDistributorId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    linkedDealerId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    linkedAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    sourceMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    priorityMasterId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null, index: true },
    locationCapturedAt: { type: Date, default: null },
    creationLatitude: { type: Number, default: null },
    creationLongitude: { type: Number, default: null },
    locationAccuracy: { type: Number, default: null },
    locationDetails: { type: leadLocationSchema, default: null },
    tags: { type: [String], default: [] },
    interests: { type: [String], default: [] },
    productInterested: { type: String, default: "", trim: true },
    productsOfInterest: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }],
    salesExecutiveSelfie: { type: leadPhotoSchema, default: null },
    shopPhoto: { type: leadPhotoSchema, default: null },
    requirements: { type: String, default: "", trim: true },
    gstNumber: { type: String, default: "", trim: true, uppercase: true },
    notes: { type: String, default: "", trim: true },
    city: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    geoLocation: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    campaignName: { type: String, default: "", trim: true },
    referenceName: { type: String, default: "", trim: true },
    nextAction: { type: String, default: "", trim: true },
    nextActionAt: { type: Date, default: null, index: true },
    nextCallbackAt: { type: Date, default: null, index: true },
    nextCallbackNote: { type: String, default: "", trim: true },
    followUpReviewRequired: { type: Boolean, default: false, index: true },
    lastActivityAt: { type: Date, default: null, index: true },
    isStale: { type: Boolean, default: false, index: true },
    staleMarkedAt: { type: Date, default: null },
    score: { type: Number, min: 0, max: 100, default: 0 },
    scoreExplanation: { type: [String], default: [] },
    temperature: { type: String, enum: ["cold", "warm", "hot"], default: "warm", index: true },
    budgetMin: { type: Number, min: 0, default: 0 },
    budgetMax: { type: Number, min: 0, default: 0 },
    expectedDecisionAt: { type: Date, default: null },
    customValues: { type: Object, default: {} },
    isDuplicate: { type: Boolean, default: false, index: true },
    duplicateOfLeadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
      index: true,
    },
    convertedAt: { type: Date, default: null },
    convertedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    convertedContactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact", default: null },
    convertedAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null },
    convertedDealId: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", default: null },
    lostReason: { type: String, default: "", trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

leadSchema.pre("validate", function (next) {
  this.normalizedEmail = String(this.email || "").trim().toLowerCase();
  this.normalizedPhone = String(this.phone || "").replace(/\D/g, "");
  this.tags = [...new Set((this.tags || []).map((item) => String(item).trim()).filter(Boolean))];
  next();
});

leadSchema.index({ companyId: 1, status: 1, assignedTo: 1, deletedAt: 1 });
leadSchema.index({ companyId: 1, createdAt: -1 });
leadSchema.index({ companyId: 1, normalizedEmail: 1, deletedAt: 1 });
leadSchema.index({ companyId: 1, normalizedPhone: 1, deletedAt: 1 });
leadSchema.index({ companyId: 1, linkedDealerId: 1 });
leadSchema.index({ companyId: 1, linkedDistributorId: 1 });
leadSchema.index({ companyId: 1, linkedAccountId: 1 });

module.exports = mongoose.model("Lead", leadSchema);
