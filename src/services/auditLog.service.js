const AuditLog = require("../models/AuditLog");

const writeAuditLog = async ({
    companyId = null,
    actorId = null,
    action,
    entityType,
    entityId = null,
    metadata = {},
    req = null,
    session = null,
}) => {
    if (!action || !entityType) return null;

    const payload = [
        {
            companyId,
            actorId,
            action,
            entityType,
            entityId,
            metadata,
            ipAddress: req?.ip || "",
            userAgent: req?.headers?.["user-agent"] || "",
        },
    ];

    const docs = session
        ? await AuditLog.create(payload, { session })
        : await AuditLog.create(payload);

    return docs[0] || null;
};

module.exports = {
    writeAuditLog,
};
