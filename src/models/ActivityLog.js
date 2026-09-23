const mongoose = require("mongoose");

const activityLogSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    entityType: { type: String, enum: ["lead", "account"], required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    activityType: {
      type: String,
      enum: [
        "followup_created",
        "followup_completed",
        "followup_rescheduled",
        "followup_skipped",
        "followup_overdue_escalated",
        "visit_started",
        "visit_completed",
        "visit_cancelled",
        "lead_created",
        "lead_status_changed",
        "lead_assigned",
        "note_added",
        "call_logged",
        "whatsapp_logged",
        "email_logged",
        "order_created",
        "deal_created",
      ],
      required: true,
      index: true,
    },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    performedAt: { type: Date, default: Date.now, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    isSystemGenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

activityLogSchema.index({ companyId: 1, entityId: 1, entityType: 1, performedAt: -1 });

module.exports = mongoose.model("ActivityLog", activityLogSchema);
