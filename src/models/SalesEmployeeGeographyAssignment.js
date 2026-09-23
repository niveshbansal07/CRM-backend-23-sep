const mongoose = require("mongoose");

const salesEmployeeGeographyAssignmentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    designationId: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", required: true, index: true },
    hierarchyLevel: { type: Number, min: 1, max: 5, required: true, index: true },
    geographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", required: true, index: true },
    geographyType: { type: String, enum: ["ZONE", "REGION", "BRANCH", "AREA"], required: true, index: true },
    assignmentType: { type: String, enum: ["PRIMARY"], default: "PRIMARY", required: true },
    isResponsibleManager: { type: Boolean, required: true, default: false, index: true },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null, index: true },
    status: { type: String, enum: ["current", "ended"], default: "current", required: true, index: true },
    isCurrent: { type: Boolean, default: true, required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignmentReason: { type: String, default: "", trim: true },
    endReason: { type: String, default: "", trim: true },
    previousAssignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesEmployeeGeographyAssignment",
      default: null,
    },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

salesEmployeeGeographyAssignmentSchema.pre("validate", function (next) {
  this.assignmentReason = String(this.assignmentReason || "").trim().replace(/\s+/g, " ");
  this.endReason = String(this.endReason || "").trim().replace(/\s+/g, " ");
  if (this.isCurrent) {
    this.status = "current";
    this.effectiveTo = null;
    this.endedBy = null;
    this.endReason = "";
  } else {
    this.status = "ended";
    if (!this.effectiveTo) this.invalidate("effectiveTo", "Ended assignment requires effectiveTo");
  }
  next();
});

salesEmployeeGeographyAssignmentSchema.index(
  { companyId: 1, employeeId: 1, assignmentType: 1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true, deletedAt: null },
    name: "uniq_current_primary_assignment_per_employee",
  }
);
salesEmployeeGeographyAssignmentSchema.index(
  { companyId: 1, geographyId: 1, isResponsibleManager: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isCurrent: true,
      isResponsibleManager: true,
      deletedAt: null,
    },
    name: "uniq_current_responsible_manager_per_geography",
  }
);
salesEmployeeGeographyAssignmentSchema.index({ companyId: 1, employeeId: 1, effectiveFrom: -1 });
salesEmployeeGeographyAssignmentSchema.index({ companyId: 1, geographyId: 1, isCurrent: 1, hierarchyLevel: 1 });
salesEmployeeGeographyAssignmentSchema.index({ companyId: 1, isCurrent: 1, effectiveFrom: -1 });

module.exports = mongoose.model(
  "SalesEmployeeGeographyAssignment",
  salesEmployeeGeographyAssignmentSchema
);
