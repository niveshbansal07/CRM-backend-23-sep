const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },

        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },

        receiverId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },

        senderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        type: {
            type: String,
            enum: [
                "employee_request_created",
                "employee_request_approved",
                "employee_request_rejected",
                "employee_request_overdue",
                "system",
                "FOLLOWUP_REMINDER",
                "FOLLOWUP_DUE_NOW",
                "FOLLOWUP_OVERDUE",
                "FOLLOWUP_OVERDUE_ESCALATION",
                "FOLLOWUP_MORNING_DIGEST",
                "LEAD_ASSIGNED",
                "DEAL_STAGE_CHANGED",
                "DEAL_APPROVAL_OVERDUE",
                "ORDER_DISCOUNT_APPROVAL",
                "followup_scheduled",
                "followup_overdue",
                "followup_reminder",
                "followup_escalation",
            ],
            required: true,
            index: true,
        },

        title: {
            type: String,
            required: true,
            trim: true,
        },

        message: {
            type: String,
            required: true,
            trim: true,
        },

        data: {
            type: Object,
            default: {},
        },

        referenceType: {
            type: String,
            enum: ["lead", "deal", "followup", "order", null],
            default: null,
            index: true,
        },

        referenceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true,
        },

        isRead: {
            type: Boolean,
            default: false,
            index: true,
        },

        readAt: {
            type: Date,
            default: null,
        },

        isSnoozed: {
            type: Boolean,
            default: false,
            index: true,
        },

        snoozedUntil: {
            type: Date,
            default: null,
        },

        deletedAt: {
            type: Date,
            default: null,
            index: true,
        },
    },
    { timestamps: true }
);

notificationSchema.index({
    receiverId: 1,
    isRead: 1,
    createdAt: -1,
});
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, userId: 1, isRead: 1, createdAt: -1 });

notificationSchema.pre("validate", function (next) {
    if (!this.tenantId && this.companyId) this.tenantId = this.companyId;
    if (!this.companyId && this.tenantId) this.companyId = this.tenantId;
    if (!this.userId && this.receiverId) this.userId = this.receiverId;
    if (!this.receiverId && this.userId) this.receiverId = this.userId;
    next();
});

module.exports = mongoose.model("Notification", notificationSchema);
