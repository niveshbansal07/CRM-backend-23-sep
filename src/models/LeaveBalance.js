const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true, index: true },
    year: { type: Number, required: true, index: true },
    openingBalance: { type: Number, default: 0 },
    credited: { type: Number, default: 0 },
    used: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    available: { type: Number, default: 0 },
    carriedForward: { type: Number, default: 0 },
    lapsed: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

leaveBalanceSchema.index({ companyId: 1, employeeId: 1, leaveTypeId: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("LeaveBalance", leaveBalanceSchema);
