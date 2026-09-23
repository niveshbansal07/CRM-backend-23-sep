const mongoose = require("mongoose");

const attendanceCorrectionRequestSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: "Attendance", default: null },
    date: { type: Date, required: true, index: true },
    type: {
      type: String,
      enum: ["MISSED_PUNCH_IN", "MISSED_PUNCH_OUT", "WRONG_PUNCH_TIME", "WORK_FROM_HOME", "ON_DUTY", "CLIENT_VISIT", "MANUAL_PRESENT"],
      required: true,
    },
    requestedPunchIn: { type: Date, default: null },
    requestedPunchOut: { type: Date, default: null },
    reason: { type: String, required: true, trim: true },
    attachmentUrl: { type: String, default: "", trim: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING", index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: "", trim: true },
    reviewerComment: { type: String, default: "", trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

attendanceCorrectionRequestSchema.index({ companyId: 1, status: 1, date: 1 });
attendanceCorrectionRequestSchema.index({ employeeId: 1, status: 1, date: 1 });

module.exports = mongoose.model("AttendanceCorrectionRequest", attendanceCorrectionRequestSchema);
