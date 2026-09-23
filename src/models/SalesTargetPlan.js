const mongoose = require("mongoose");
const { SALES_PERFORMANCE, PLAN_STATUSES } = require("../constants/salesPerformance");

const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  metricCode: { type: String, enum: [SALES_PERFORMANCE.METRIC_CODE], default: SALES_PERFORMANCE.METRIC_CODE, index: true },
  metricLabel: { type: String, default: SALES_PERFORMANCE.METRIC_LABEL },
  periodType: { type: String, enum: ["MONTH"], default: "MONTH" },
  periodKey: { type: String, required: true, index: true },
  periodStart: { type: Date, required: true, index: true },
  periodEndExclusive: { type: Date, required: true, index: true },
  fiscalYearLabel: { type: String, required: true },
  currency: { type: String, required: true, uppercase: true },
  timezone: { type: String, required: true },
  policyVersion: { type: Number, required: true },
  version: { type: Number, default: 1, min: 1 },
  revisionOfPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "SalesTargetPlan", default: null, index: true },
  revisionReason: { type: String, default: "", trim: true, maxlength: 500 },
  status: { type: String, enum: PLAN_STATUSES, default: "DRAFT", index: true },
  submittedAt: { type: Date, default: null },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  rejectionReason: { type: String, default: "", trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

schema.index({ companyId: 1, metricCode: 1, periodStart: 1, periodEndExclusive: 1, version: 1 }, { unique: true });
schema.index({ companyId: 1, status: 1, periodStart: -1 });
schema.index({ revisionOfPlanId: 1, version: -1 });
schema.index({ companyId: 1, metricCode: 1, periodStart: 1, periodEndExclusive: 1 }, { unique: true, partialFilterExpression: { status: "ACTIVE" }, name: "uniq_active_target_period" });
module.exports = mongoose.model("SalesTargetPlan", schema);
