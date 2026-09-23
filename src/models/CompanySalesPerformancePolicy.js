const mongoose = require("mongoose");
const { SALES_PERFORMANCE, POLICY_STATUSES } = require("../constants/salesPerformance");

const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, unique: true, index: true },
  baseCurrency: { type: String, default: SALES_PERFORMANCE.DEFAULT_CURRENCY, uppercase: true, trim: true },
  timezone: { type: String, default: SALES_PERFORMANCE.DEFAULT_TIMEZONE, trim: true },
  fiscalStartMonth: { type: Number, default: SALES_PERFORMANCE.DEFAULT_FISCAL_START_MONTH, min: 1, max: 12 },
  metricCode: { type: String, enum: [SALES_PERFORMANCE.METRIC_CODE], default: SALES_PERFORMANCE.METRIC_CODE },
  metricLabel: { type: String, enum: [SALES_PERFORMANCE.METRIC_LABEL], default: SALES_PERFORMANCE.METRIC_LABEL },
  trigger: { type: String, enum: [SALES_PERFORMANCE.TRIGGER], default: SALES_PERFORMANCE.TRIGGER },
  valueBasis: { type: String, enum: [SALES_PERFORMANCE.VALUE_BASIS], default: SALES_PERFORMANCE.VALUE_BASIS },
  periodType: { type: String, enum: [SALES_PERFORMANCE.PERIOD_TYPE], default: SALES_PERFORMANCE.PERIOD_TYPE },
  allocationPolicy: { type: String, enum: [SALES_PERFORMANCE.ALLOCATION_POLICY], default: SALES_PERFORMANCE.ALLOCATION_POLICY },
  attributionPolicy: { type: String, enum: [SALES_PERFORMANCE.ATTRIBUTION_POLICY], default: SALES_PERFORMANCE.ATTRIBUTION_POLICY },
  policyVersion: { type: Number, default: 1, min: 1 },
  status: { type: String, enum: POLICY_STATUSES, default: "DRAFT", index: true },
  activationDate: { type: Date, default: null, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
}, { timestamps: true });

schema.index({ companyId: 1, status: 1, activationDate: 1 });
module.exports = mongoose.model("CompanySalesPerformancePolicy", schema);
