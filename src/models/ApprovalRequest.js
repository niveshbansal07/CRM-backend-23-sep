const mongoose = require("mongoose");

const approvalRequestSchema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    requestType: {
      type: String,
      enum: ["order_discount", "deal_discount", "visit_review"],
      required: true,
      index: true,
    },
    targetType: { type: String, enum: ["order", "deal", "visit"], required: true, index: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    approverRole: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    reason: { type: String, default: "", trim: true },
    metadata: { type: Object, default: {} },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    comments: { type: String, default: "", trim: true },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

approvalRequestSchema.index({ companyId: 1, requestType: 1, status: 1 });
approvalRequestSchema.index({ companyId: 1, targetType: 1, targetId: 1, status: 1 });

module.exports = mongoose.model("ApprovalRequest", approvalRequestSchema);
