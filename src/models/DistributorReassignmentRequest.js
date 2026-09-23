const mongoose = require("mongoose");
const { REQUEST_STATUSES, APPROVAL_LEVELS, BOUNDARY_TYPES } = require("../constants/distributorReassignment");

const distributorReassignmentRequestSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    distributorAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    currentAssignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DistributorSalesAssignment", required: true, index: true },
    oldPrimaryFsdId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    newPrimaryFsdId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    geographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", required: true, index: true },
    destinationGeographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null, index: true },
    boundaryType: { type: String, enum: Object.values(BOUNDARY_TYPES), default: BOUNDARY_TYPES.SAME_AREA, required: true, index: true },
    requestType: { type: String, enum: ["SAME_AREA_FSD_REASSIGNMENT", "CROSS_GEOGRAPHY_TRANSFER"], default: "SAME_AREA_FSD_REASSIGNMENT", required: true },
    requiredApprovalLevel: { type: String, enum: Object.values(APPROVAL_LEVELS), default: APPROVAL_LEVELS.ASM, required: true },
    approvalScopeGeographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null, index: true },
    sourceBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    sourceRegionId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    sourceZoneId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    destinationBranchId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    destinationRegionId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    destinationZoneId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    warnings: [{ type: String, trim: true }],
    status: { type: String, enum: Object.values(REQUEST_STATUSES), default: REQUEST_STATUSES.PENDING, required: true, index: true },
    isOpen: { type: Boolean, default: true, required: true, index: true },
    approvalLevel: { type: String, enum: Object.values(APPROVAL_LEVELS), required: true, index: true },
    requestedApproverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decisionReason: { type: String, default: "", trim: true, maxlength: 500 },
    overrideUsed: { type: Boolean, default: false },
    overrideReason: { type: String, default: "", trim: true, maxlength: 500 },
    reviewedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    appliedAt: { type: Date, default: null, index: true },
    operationId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    appliedAssignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DistributorSalesAssignment", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

distributorReassignmentRequestSchema.pre("validate", function (next) {
  this.reason = String(this.reason || "").trim().replace(/\s+/g, " ");
  this.decisionReason = String(this.decisionReason || "").trim().replace(/\s+/g, " ");
  this.overrideReason = String(this.overrideReason || "").trim().replace(/\s+/g, " ");
  if (this.destinationGeographyId && String(this.destinationGeographyId) !== String(this.geographyId)) {
    this.requestType = "CROSS_GEOGRAPHY_TRANSFER";
  } else {
    this.requestType = "SAME_AREA_FSD_REASSIGNMENT";
    this.destinationGeographyId = this.geographyId;
    this.boundaryType = BOUNDARY_TYPES.SAME_AREA;
  }
  this.isOpen = [REQUEST_STATUSES.PENDING, REQUEST_STATUSES.APPROVED].includes(this.status);
  next();
});

distributorReassignmentRequestSchema.index(
  { companyId: 1, distributorAccountId: 1 },
  {
    unique: true,
    partialFilterExpression: { isOpen: true, deletedAt: null },
    name: "uniq_open_distributor_reassignment",
  }
);
distributorReassignmentRequestSchema.index({ companyId: 1, status: 1, createdAt: -1 });
distributorReassignmentRequestSchema.index({ companyId: 1, geographyId: 1, status: 1, createdAt: -1 });
distributorReassignmentRequestSchema.index({ companyId: 1, destinationGeographyId: 1, status: 1, createdAt: -1 });
distributorReassignmentRequestSchema.index({ companyId: 1, boundaryType: 1, status: 1, createdAt: -1 });
distributorReassignmentRequestSchema.index({ companyId: 1, distributorAccountId: 1, createdAt: -1 });

module.exports = mongoose.model("DistributorReassignmentRequest", distributorReassignmentRequestSchema);
