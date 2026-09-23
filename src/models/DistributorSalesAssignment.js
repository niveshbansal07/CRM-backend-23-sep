const mongoose = require("mongoose");

const distributorSalesAssignmentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    distributorAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", required: true, index: true },
    geographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", required: true, index: true },
    geographyType: { type: String, enum: ["AREA"], default: "AREA", required: true },
    primaryFsdId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null, index: true },
    status: { type: String, enum: ["current", "ended"], default: "current", required: true, index: true },
    isCurrent: { type: Boolean, default: true, required: true, index: true },
    operationId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    endedOperationId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    previousAssignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DistributorSalesAssignment",
      default: null,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignmentReason: { type: String, required: true, trim: true, maxlength: 500 },
    endReason: { type: String, default: "", trim: true, maxlength: 500 },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

distributorSalesAssignmentSchema.pre("validate", function (next) {
  this.geographyType = "AREA";
  this.assignmentReason = String(this.assignmentReason || "").trim().replace(/\s+/g, " ");
  this.endReason = String(this.endReason || "").trim().replace(/\s+/g, " ");
  if (this.isCurrent) {
    this.status = "current";
    this.effectiveTo = null;
      this.endedBy = null;
      this.endedOperationId = null;
    this.endReason = "";
  } else {
    this.status = "ended";
    if (!this.effectiveTo) this.invalidate("effectiveTo", "Ended Distributor mapping requires effectiveTo");
  }
  next();
});

distributorSalesAssignmentSchema.index(
  { companyId: 1, distributorAccountId: 1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true, deletedAt: null },
    name: "uniq_current_distributor_sales_mapping",
  }
);
distributorSalesAssignmentSchema.index({ companyId: 1, primaryFsdId: 1, isCurrent: 1, deletedAt: 1 });
distributorSalesAssignmentSchema.index({ companyId: 1, geographyId: 1, isCurrent: 1, deletedAt: 1 });
distributorSalesAssignmentSchema.index({ companyId: 1, distributorAccountId: 1, effectiveFrom: -1 });

module.exports = mongoose.model("DistributorSalesAssignment", distributorSalesAssignmentSchema);
