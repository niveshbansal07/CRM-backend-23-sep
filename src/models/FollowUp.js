const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");

const followUpSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", default: null, index: true },
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: "Account", default: null, index: true },
    visitId: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", default: null, index: true },
    relatedVisitId: { type: mongoose.Schema.Types.ObjectId, ref: "Visit", default: null, index: true },
    relatedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    followUpType: {
      type: String,
      enum: ["call", "whatsapp", "visit", "email", "meeting", "demo", "site_visit", "other"],
      default: "call",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: "", trim: true },
    source: {
      type: String,
      enum: ["manual", "visit_end", "lead_create", "system_auto", "manager"],
      default: "manual",
      trim: true,
      index: true,
    },
    note: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["pending", "completed", "rescheduled", "skipped", "cancelled", "overdue"],
      default: "pending",
      required: true,
      index: true,
    },
    priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal", index: true },
    parentFollowUpId: { type: mongoose.Schema.Types.ObjectId, ref: "FollowUp", default: null, index: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    completionNotes: { type: String, default: "", trim: true },
    completionOutcomeId: { type: mongoose.Schema.Types.ObjectId, ref: "CrmMaster", default: null },
    rescheduledFrom: { type: Date, default: null },
    rescheduleReason: { type: String, default: "", trim: true },
    reminderSentAt: { type: Date, default: null },
    escalatedAt: { type: Date, default: null },
    escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isOverdue: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

followUpSchema.pre("validate", function (next) {
  if (!this.notes && this.note) this.notes = this.note;
  if (!this.note && this.notes) this.note = this.notes;
  if (!this.relatedVisitId && this.visitId) this.relatedVisitId = this.visitId;
  if (!this.title) this.title = this.notes || this.note || "Follow-up";
  if (this.isNew && this.scheduledAt && new Date(this.scheduledAt).getTime() <= Date.now()) {
    return next(new ApiError(400, "Follow-up scheduled time must be in the future"));
  }
  if (this.isModified("status") && this.status === "completed" && !String(this.completionNotes || "").trim()) {
    return next(new ApiError(400, "Completion notes are required to complete a follow-up"));
  }
  return next();
});

followUpSchema.index({ companyId: 1, assignedTo: 1, scheduledAt: 1, status: 1 });
followUpSchema.index({ companyId: 1, source: 1, visitId: 1 });
followUpSchema.index({ companyId: 1, leadId: 1, scheduledAt: 1 });
followUpSchema.index({ companyId: 1, status: 1, scheduledAt: 1 });
followUpSchema.index({ companyId: 1, isOverdue: 1, assignedTo: 1 });

module.exports = mongoose.model("FollowUp", followUpSchema);
