const mongoose = require("mongoose");

const leaveTypeSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    paid: { type: Boolean, default: true },
    yearlyQuota: { type: Number, default: 0, min: 0 },
    accrualType: { type: String, enum: ["YEARLY", "MONTHLY", "QUARTERLY", "MANUAL"], default: "YEARLY" },
    accrualValue: { type: Number, default: 0, min: 0 },
    allowHalfDay: { type: Boolean, default: true },
    allowCarryForward: { type: Boolean, default: false },
    maxCarryForward: { type: Number, default: 0, min: 0 },
    allowNegativeBalance: { type: Boolean, default: false },
    requiresAttachmentAfterDays: { type: Number, default: 0, min: 0 },
    requiresApproval: { type: Boolean, default: true },
    applicableFor: {
      departments: { type: [String], default: [] },
      roles: { type: [String], default: [] },
      employeeTypes: { type: [String], default: [] },
    },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

leaveTypeSchema.index(
  { companyId: 1, code: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);

module.exports = mongoose.model("LeaveType", leaveTypeSchema);
