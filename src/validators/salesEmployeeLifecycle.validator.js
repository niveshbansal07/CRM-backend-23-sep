const mongoose = require("mongoose");
const { cleanString } = require("../utils/normalize");

const fail = (res, errors) => res.status(400).json({
  success: false,
  message: "Validation failed.",
  errors,
});

const forbiddenFields = [
  "companyId", "oldGeographyId", "oldManagerId", "hierarchyLevel", "technicalRole",
  "effectiveAt", "effectiveFrom", "effectiveTo", "operationId", "changedBy",
  "geographyId", "reportingManagerId", "designationId", "status",
];

const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const validateTransferPayload = (req, res, next) => {
  const body = req.body || {};
  const employeeId = cleanString(body.employeeId);
  const targetGeographyId = cleanString(body.targetGeographyId);
  const proposedReportingManagerId = cleanString(body.proposedReportingManagerId);
  const reason = cleanString(body.reason);
  const errors = [];
  if (!validId(employeeId)) errors.push("employeeId must be a valid ObjectId.");
  if (targetGeographyId && !validId(targetGeographyId)) errors.push("targetGeographyId must be a valid ObjectId.");
  if (proposedReportingManagerId && !validId(proposedReportingManagerId)) errors.push("proposedReportingManagerId must be a valid ObjectId.");
  if (!targetGeographyId && !proposedReportingManagerId) errors.push("Provide targetGeographyId or proposedReportingManagerId.");
  if (reason.length < 2) errors.push("A transfer reason is required.");
  if (reason.length > 500) errors.push("Transfer reason must be 500 characters or less.");
  const controlled = forbiddenFields.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (controlled.length) errors.push(`Client-controlled fields are not allowed: ${controlled.join(", ")}.`);
  if (errors.length) return fail(res, errors);
  req.validatedBody = {
    employeeId,
    ...(targetGeographyId ? { targetGeographyId } : {}),
    ...(proposedReportingManagerId ? { proposedReportingManagerId } : {}),
    reason,
    replaceCurrentHolder: body.replaceCurrentHolder === true,
  };
  next();
};

const validateReason = (req, res, next) => {
  const reason = cleanString(req.body?.reason);
  const errors = [];
  if (reason.length < 2) errors.push("A reason is required.");
  if (reason.length > 500) errors.push("Reason must be 500 characters or less.");
  if (errors.length) return fail(res, errors);
  req.validatedBody = { reason };
  next();
};

const validateOffboarding = (req, res, next) => {
  const targetStatus = cleanString(req.body?.targetStatus || req.body?.status);
  const reason = cleanString(req.body?.reason);
  const errors = [];
  if (!["disabled", "deleted", "suspended"].includes(targetStatus)) {
    errors.push("targetStatus must be disabled, deleted, or suspended.");
  }
  if (["disabled", "deleted"].includes(targetStatus) && reason.length < 2) {
    errors.push("An offboarding reason is required.");
  }
  if (reason.length > 500) errors.push("Reason must be 500 characters or less.");
  if (errors.length) return fail(res, errors);
  req.validatedBody = { targetStatus, reason };
  next();
};

const validateManagerCandidateQuery = (req, res, next) => {
  const geographyId = cleanString(req.query?.geographyId);
  if (geographyId && !validId(geographyId)) return fail(res, ["geographyId must be a valid ObjectId."]);
  req.validatedQuery = { geographyId: geographyId || null };
  next();
};

module.exports = {
  validateTransferPayload,
  validateReason,
  validateOffboarding,
  validateManagerCandidateQuery,
};
