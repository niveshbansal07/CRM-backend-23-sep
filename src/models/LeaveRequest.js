const mongoose = require("mongoose");

const leaveRequestSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true, index: true },
    fromDate: { type: Date, required: true, index: true },
    toDate: { type: Date, required: true, index: true },
    durationType: { type: String, enum: ["FULL_DAY", "HALF_DAY", "MULTI_DAY"], default: "FULL_DAY" },
    halfDayPart: { type: String, enum: ["FIRST_HALF", "SECOND_HALF", ""], default: "" },
    totalDays: { type: Number, required: true, min: 0.5 },
    reason: { type: String, required: true, trim: true },
    attachmentUrl: { type: String, default: "", trim: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "CANCEL_REQUESTED"], default: "PENDING", index: true },
    currentApproverId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvalHistory: {
      type: [
        {
          action: String,
          actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          comment: String,
          actedAt: Date,
        },
      ],
      default: [],
    },
    appliedAt: { type: Date, default: Date.now },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", trim: true },
    cancelledAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ companyId: 1, employeeId: 1, status: 1, fromDate: 1, toDate: 1 });

module.exports = mongoose.model("LeaveRequest", leaveRequestSchema);
