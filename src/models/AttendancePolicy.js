const mongoose = require("mongoose");

const attendancePolicySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    weeklyOffs: { type: [Number], default: [0, 6] },
    fullDayMinutes: { type: Number, default: 480, min: 1 },
    halfDayMinutes: { type: Number, default: 240, min: 1 },
    graceMinutes: { type: Number, default: 10, min: 0 },
    breakMinutes: { type: Number, default: 60, min: 0 },
    lateAllowedPerMonth: { type: Number, default: 2, min: 0 },
    lateAfterTime: { type: String, default: "12:00", trim: true },
    thirdLatePenalty: { type: String, enum: ["HALF_DAY", "ABSENT", "LOSS_OF_PAY"], default: "HALF_DAY" },
    consecutiveLateLimit: { type: Number, default: 3, min: 0 },
    afterConsecutiveLatePenalty: { type: String, enum: ["ABSENT", "LOSS_OF_PAY", "HALF_DAY"], default: "ABSENT" },
    overtimeEnabled: { type: Boolean, default: false },
    overtimeAfterMinutes: { type: Number, default: 540, min: 1 },
    correctionAllowed: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: true, index: true },
    status: { type: String, enum: ["active", "inactive"], default: "active", index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

attendancePolicySchema.index({ companyId: 1, isDefault: 1, status: 1, deletedAt: 1 });

module.exports = mongoose.model("AttendancePolicy", attendancePolicySchema);
