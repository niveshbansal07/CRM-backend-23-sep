const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
    {
        companyId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Company",
            default: null,
            index: true,
        },
        actorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
            index: true,
        },
        action: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        entityType: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        entityId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            index: true,
        },
        metadata: {
            type: Object,
            default: {},
        },
        ipAddress: {
            type: String,
            default: "",
        },
        userAgent: {
            type: String,
            default: "",
        },
    },
    { timestamps: true }
);

auditLogSchema.index({ companyId: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
