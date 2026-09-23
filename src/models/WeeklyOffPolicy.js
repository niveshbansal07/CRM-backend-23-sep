const mongoose = require("mongoose");

const weeklyOffPolicySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    weeklyOffDays: { type: [Number], default: [0, 6] },
    secondAndFourthSaturdayOff: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

weeklyOffPolicySchema.index({ companyId: 1, isDefault: 1, isActive: 1, deletedAt: 1 });

module.exports = mongoose.model("WeeklyOffPolicy", weeklyOffPolicySchema);
