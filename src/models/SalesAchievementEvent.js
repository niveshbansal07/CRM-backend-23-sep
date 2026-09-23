const mongoose = require("mongoose");
const { SALES_PERFORMANCE, ATTRIBUTION_CONFIDENCE } = require("../constants/salesPerformance");

const snapshotSchema = new mongoose.Schema({
  sourceAccountId: { type: mongoose.Schema.Types.ObjectId, default: null }, sourceAccountType: { type: String, default: "" },
  rootDistributorId: { type: mongoose.Schema.Types.ObjectId, default: null }, rootDistributorName: { type: String, default: "" }, rootDistributorCode: { type: String, default: "" },
  distributorAssignmentId: { type: mongoose.Schema.Types.ObjectId, default: null }, primaryFsdId: { type: mongoose.Schema.Types.ObjectId, default: null }, primaryFsdName: { type: String, default: "" },
  areaId: { type: mongoose.Schema.Types.ObjectId, default: null }, areaName: { type: String, default: "" }, areaCode: { type: String, default: "" },
  branchId: { type: mongoose.Schema.Types.ObjectId, default: null }, branchName: { type: String, default: "" }, branchCode: { type: String, default: "" },
  regionId: { type: mongoose.Schema.Types.ObjectId, default: null }, regionName: { type: String, default: "" }, regionCode: { type: String, default: "" },
  zoneId: { type: mongoose.Schema.Types.ObjectId, default: null }, zoneName: { type: String, default: "" }, zoneCode: { type: String, default: "" },
  employeeAssignmentId: { type: mongoose.Schema.Types.ObjectId, default: null }, attributionSource: { type: String, default: "" }, warnings: { type: [String], default: [] },
}, { _id: false });

const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  sourceType: { type: String, enum: ["ORDER"], default: "ORDER", index: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  sourceEvent: { type: String, enum: [SALES_PERFORMANCE.TRIGGER], default: SALES_PERFORMANCE.TRIGGER },
  sourceEventVersion: { type: Number, default: 1 },
  operationId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  occurredAt: { type: Date, required: true, index: true },
  recordedAt: { type: Date, default: Date.now, immutable: true },
  metricCode: { type: String, enum: [SALES_PERFORMANCE.METRIC_CODE], default: SALES_PERFORMANCE.METRIC_CODE, index: true },
  metricLabel: { type: String, default: SALES_PERFORMANCE.METRIC_LABEL },
  amount: { type: mongoose.Schema.Types.Decimal128, required: true },
  currency: { type: String, required: true },
  policyVersion: { type: Number, required: true },
  confidence: { type: String, enum: ATTRIBUTION_CONFIDENCE, required: true, index: true },
  rollupEligible: { type: Boolean, required: true, index: true },
  dataQuality: { type: String, enum: ["VALID", "WARNING", "UNATTRIBUTABLE"], required: true, index: true },
  snapshot: { type: snapshotSchema, required: true },
}, { timestamps: false, strict: true });

schema.index({ companyId: 1, sourceType: 1, sourceId: 1, sourceEvent: 1, sourceEventVersion: 1 }, { unique: true, name: "uniq_sales_achievement_source_event" });
schema.index({ companyId: 1, metricCode: 1, occurredAt: 1, rollupEligible: 1 });
schema.index({ companyId: 1, "snapshot.primaryFsdId": 1, occurredAt: 1 });
schema.index({ companyId: 1, "snapshot.rootDistributorId": 1, occurredAt: 1 });
schema.index({ companyId: 1, "snapshot.areaId": 1, occurredAt: 1 });
schema.index({ companyId: 1, "snapshot.branchId": 1, occurredAt: 1 });
schema.index({ companyId: 1, "snapshot.regionId": 1, occurredAt: 1 });
schema.index({ companyId: 1, "snapshot.zoneId": 1, occurredAt: 1 });

const rejectMutation = (next) => next(new Error("Sales achievement events are append-only"));
["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete"].forEach((operation) => schema.pre(operation, rejectMutation));
schema.pre("save", function (next) {
  if (!this.isNew) return next(new Error("Sales achievement events are append-only"));
  return next();
});
module.exports = mongoose.model("SalesAchievementEvent", schema);
