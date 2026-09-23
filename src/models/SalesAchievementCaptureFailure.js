const mongoose = require("mongoose");
const { SALES_PERFORMANCE } = require("../constants/salesPerformance");

const schema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  operationId: { type: mongoose.Schema.Types.ObjectId, required: true, default: () => new mongoose.Types.ObjectId(), index: true },
  sourceEvent: { type: String, enum: [SALES_PERFORMANCE.TRIGGER], default: SALES_PERFORMANCE.TRIGGER },
  sourceEventVersion: { type: Number, default: 1 },
  errorCode: { type: String, default: "ACHIEVEMENT_CAPTURE_FAILED", trim: true },
  errorSummary: { type: String, required: true, trim: true, maxlength: 500 },
  attemptCount: { type: Number, default: 0, min: 0 },
  lastAttemptAt: { type: Date, default: Date.now, index: true },
  resolvedAt: { type: Date, default: null, index: true },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN", index: true },
}, { timestamps: true });

schema.index({ companyId: 1, orderId: 1, sourceEvent: 1, sourceEventVersion: 1 }, { unique: true, name: "uniq_sales_achievement_capture_failure" });
schema.index({ companyId: 1, operationId: 1 }, { unique: true, sparse: true, name: "uniq_sales_achievement_failure_operation" });
schema.index({ companyId: 1, status: 1, lastAttemptAt: -1 });

module.exports = mongoose.model("SalesAchievementCaptureFailure", schema);
