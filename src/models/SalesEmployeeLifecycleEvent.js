const mongoose = require("mongoose");

const EVENT_TYPES = [
  "GEOGRAPHY_TRANSFER",
  "REPORTING_MANAGER_CHANGE",
  "GEOGRAPHY_AND_MANAGER_TRANSFER",
  "END_ASSIGNMENT",
  "EMPLOYEE_OFFBOARDING",
];

const salesEmployeeLifecycleEventSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    operationId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: EVENT_TYPES, required: true, index: true },
    oldGeographyAssignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesEmployeeGeographyAssignment",
      default: null,
    },
    newGeographyAssignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SalesEmployeeGeographyAssignment",
      default: null,
    },
    oldGeographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    newGeographyId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesGeography", default: null },
    oldGeographyPath: { type: Object, default: null },
    newGeographyPath: { type: Object, default: null },
    oldReportingManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    newReportingManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    oldReportingManagerName: { type: String, default: "", trim: true },
    newReportingManagerName: { type: String, default: "", trim: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorName: { type: String, default: "", trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    effectiveAt: { type: Date, required: true, index: true },
    displacedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    targetStatus: { type: String, default: null },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

salesEmployeeLifecycleEventSchema.index({ companyId: 1, employeeId: 1, effectiveAt: -1 });
salesEmployeeLifecycleEventSchema.index({ companyId: 1, type: 1, effectiveAt: -1 });

module.exports = mongoose.model("SalesEmployeeLifecycleEvent", salesEmployeeLifecycleEventSchema);
module.exports.EVENT_TYPES = EVENT_TYPES;
