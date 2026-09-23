const mongoose = require("mongoose");

const leavePolicySchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sandwichRuleEnabled: { type: Boolean, default: false },
    allowBackdatedLeave: { type: Boolean, default: false },
    maxBackdatedDays: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

leavePolicySchema.index({ companyId: 1, isDefault: 1, isActive: 1, deletedAt: 1 });

module.exports = mongoose.model("LeavePolicy", leavePolicySchema);
