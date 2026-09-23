const mongoose = require("mongoose");
const { OWNER_TYPES } = require("../constants/salesPerformance");

const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesTargetPlan", required: true, index: true },
  parentAllocationId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesTargetAllocation", default: null, index: true },
  ownerType: { type: String, enum: OWNER_TYPES, required: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  ownerNameSnapshot: { type: String, required: true, trim: true },
  ownerCodeSnapshot: { type: String, default: "", trim: true },
  targetValue: { type: mongoose.Schema.Types.Decimal128, required: true },
  allocatedValue: { type: mongoose.Schema.Types.Decimal128, default: () => mongoose.Types.Decimal128.fromString("0.00") },
  unallocatedValue: { type: mongoose.Schema.Types.Decimal128, default: () => mongoose.Types.Decimal128.fromString("0.00") },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

schema.index({ companyId: 1, planId: 1, ownerType: 1, ownerId: 1 }, { unique: true });
schema.index({ companyId: 1, planId: 1, parentAllocationId: 1 });
schema.index({ companyId: 1, ownerType: 1, ownerId: 1, planId: 1 });
module.exports = mongoose.model("SalesTargetAllocation", schema);
