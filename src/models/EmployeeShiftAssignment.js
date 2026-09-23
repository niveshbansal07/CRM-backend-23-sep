const mongoose = require("mongoose");

const employeeShiftAssignmentSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", required: true, index: true },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date, default: null, index: true },
    isActive: { type: Boolean, default: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

employeeShiftAssignmentSchema.index({ companyId: 1, employeeId: 1, effectiveFrom: -1 });

module.exports = mongoose.model("EmployeeShiftAssignment", employeeShiftAssignmentSchema);
