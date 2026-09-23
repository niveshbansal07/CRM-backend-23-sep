const mongoose = require("mongoose");

const locationSchema = new mongoose.Schema(
  { latitude: Number, longitude: Number, accuracy: Number },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", default: null },
    date: { type: Date, required: true, index: true },
    punchInAt: { type: Date, default: null },
    punchOutAt: { type: Date, default: null },
    punchInIp: { type: String, default: "" },
    punchOutIp: { type: String, default: "" },
    punchInUserAgent: { type: String, default: "" },
    punchOutUserAgent: { type: String, default: "" },
    punchInLocation: { type: locationSchema, default: null },
    punchOutLocation: { type: locationSchema, default: null },
    deviceType: { type: String, enum: ["web", "mobile", "unknown"], default: "web" },
    lateByMinutes: { type: Number, default: 0 },
    earlyOutMinutes: { type: Number, default: 0 },
    totalWorkMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: [
        "PRESENT",
        "ABSENT",
        "HALF_DAY",
        "LATE",
        "EARLY_OUT",
        "ON_LEAVE",
        "HALF_DAY_LEAVE_HALF_DAY_PRESENT",
        "HOLIDAY",
        "WEEKLY_OFF",
        "WORK_FROM_HOME",
        "REMOTE_WORK",
        "PENDING_CORRECTION",
        "MISSED_PUNCH",
        "OVERTIME",
        "LOSS_OF_PAY",
        "HOLIDAY_WORKED",
        "WEEKLY_OFF_WORKED",
      ],
      default: "ABSENT",
      index: true,
    },
    punchStatus: { type: String, enum: ["NOT_STARTED", "PUNCHED_IN", "PUNCHED_OUT"], default: "NOT_STARTED" },
    payableDayValue: { type: Number, default: 0 },
    lopValue: { type: Number, default: 0 },
    isRegularized: { type: Boolean, default: false },
    regularizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    regularizedAt: { type: Date, default: null },
    source: { type: String, enum: ["punch", "auto_close", "leave", "correction"], default: "punch" },
    remarks: { type: String, trim: true, default: "" },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

attendanceSchema.index(
  { companyId: 1, employeeId: 1, date: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
attendanceSchema.index({ companyId: 1, date: 1, status: 1 });

module.exports = mongoose.model("Attendance", attendanceSchema);
