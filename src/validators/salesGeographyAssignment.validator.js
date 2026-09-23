const mongoose = require("mongoose");
const { cleanString } = require("../utils/normalize");

const fail = (res, errors) => res.status(400).json({
  success: false,
  message: "Validation failed.",
  errors,
});

const forbiddenFields = [
  "companyId", "designationId", "hierarchyLevel", "geographyType", "effectiveFrom",
  "effectiveTo", "status", "isCurrent", "assignedBy", "endedBy", "deletedAt",
];

const validateAssignmentPayload = (mode) => (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const employeeId = cleanString(body.employeeId);
  const geographyId = cleanString(body.geographyId);
  const reason = cleanString(body.reason);
  const controlled = forbiddenFields.filter((field) => Object.prototype.hasOwnProperty.call(body, field));

  if (!mongoose.Types.ObjectId.isValid(employeeId)) errors.push("employeeId must be a valid ObjectId.");
  if (!mongoose.Types.ObjectId.isValid(geographyId)) errors.push("geographyId must be a valid ObjectId.");
  if (reason.length > 500) errors.push("Reason must be 500 characters or less.");
  if (controlled.length) errors.push(`Client-controlled fields are not allowed: ${controlled.join(", ")}.`);

  if (errors.length) return fail(res, errors);
  req.validatedBody = {
    employeeId,
    geographyId,
    reason,
    replaceCurrentHolder: body.replaceCurrentHolder === true,
  };
  next();
};

const validateEndAssignment = (req, res, next) => {
  const reason = cleanString(req.body?.reason);
  const controlled = forbiddenFields.filter((field) => Object.prototype.hasOwnProperty.call(req.body || {}, field));
  const errors = [];
  if (reason.length < 2) errors.push("A reason is required to end an assignment.");
  if (reason.length > 500) errors.push("Reason must be 500 characters or less.");
  if (controlled.length) errors.push(`Client-controlled fields are not allowed: ${controlled.join(", ")}.`);
  if (errors.length) return fail(res, errors);
  req.validatedBody = { reason };
  next();
};

const validateObjectIdParam = (name) => (req, res, next) => {
  const value = req.params?.[name];
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    return fail(res, [`${name} must be a valid ObjectId.`]);
  }
  next();
};

module.exports = {
  validateAssignmentPreview: validateAssignmentPayload("preview"),
  validateAssignmentApply: validateAssignmentPayload("assign"),
  validateEndAssignment,
  validateObjectIdParam,
};
