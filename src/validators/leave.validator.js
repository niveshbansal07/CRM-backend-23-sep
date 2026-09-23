const mongoose = require("mongoose");

const EMAIL_SAFE_TEXT = /^[\w\s.,'"/():;&+-]+$/;

const cleanString = (value = "") => String(value || "").trim().replace(/\s+/g, " ");
const cleanArray = (value) => (Array.isArray(value) ? value : []);
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const isValidDate = (value) => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime());
};

const fail = (res, errors) => res.status(400).json({
  success: false,
  message: "Validation failed.",
  errors,
});

const validateLeaveTypePayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const name = cleanString(body.name);
  const code = cleanString(body.code).toUpperCase();

  if (!name) errors.push("Leave type name is required.");
  if (!code) errors.push("Leave type code is required.");
  if (name && !EMAIL_SAFE_TEXT.test(name)) errors.push("Leave type name contains invalid characters.");
  if (Number(body.yearlyQuota || 0) < 0) errors.push("yearlyQuota cannot be negative.");

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    name,
    code,
    paid: body.paid !== undefined ? Boolean(body.paid) : true,
    yearlyQuota: body.yearlyQuota !== undefined ? Number(body.yearlyQuota) : 0,
    accrualType: body.accrualType || "YEARLY",
    accrualValue: body.accrualValue !== undefined ? Number(body.accrualValue) : 0,
    allowHalfDay: body.allowHalfDay !== undefined ? Boolean(body.allowHalfDay) : true,
    allowCarryForward: Boolean(body.allowCarryForward),
    maxCarryForward: body.maxCarryForward !== undefined ? Number(body.maxCarryForward) : 0,
    allowNegativeBalance: Boolean(body.allowNegativeBalance),
    requiresAttachmentAfterDays: body.requiresAttachmentAfterDays !== undefined ? Number(body.requiresAttachmentAfterDays) : 0,
    requiresApproval: body.requiresApproval !== undefined ? Boolean(body.requiresApproval) : true,
    applicableFor: {
      departments: cleanArray(body.applicableFor?.departments || body.departments).map(cleanString).filter(Boolean),
      roles: cleanArray(body.applicableFor?.roles || body.roles).map(cleanString).filter(Boolean),
      employeeTypes: cleanArray(body.applicableFor?.employeeTypes || body.employeeTypes).map(cleanString).filter(Boolean),
    },
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
  };
  next();
};

const validateLeaveApplyPayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];

  if (!isValidObjectId(body.leaveTypeId)) errors.push("leaveTypeId must be a valid ObjectId.");
  if (!isValidDate(body.fromDate)) errors.push("fromDate is required and must be valid.");
  if (!isValidDate(body.toDate || body.fromDate)) errors.push("toDate must be valid.");
  if (!cleanString(body.reason)) errors.push("Reason is required.");

  const fromDate = new Date(body.fromDate);
  const toDate = new Date(body.toDate || body.fromDate);
  if (!errors.length && fromDate > toDate) errors.push("fromDate cannot be after toDate.");

  const durationType = body.durationType || (body.isHalfDay ? "HALF_DAY" : "FULL_DAY");
  if (!["FULL_DAY", "HALF_DAY", "MULTI_DAY"].includes(durationType)) {
    errors.push("durationType is invalid.");
  }

  if (durationType === "HALF_DAY" && !["FIRST_HALF", "SECOND_HALF"].includes(body.halfDayPart || body.halfDaySession)) {
    errors.push("halfDayPart is required for half-day leave.");
  }

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    leaveTypeId: body.leaveTypeId,
    fromDate,
    toDate,
    durationType,
    halfDayPart: durationType === "HALF_DAY" ? (body.halfDayPart || body.halfDaySession) : "",
    reason: cleanString(body.reason),
    attachmentUrl: cleanString(body.attachmentUrl),
  };
  next();
};

const validateLeaveReview = (req, res, next) => {
  req.validatedBody = {
    comment: cleanString(req.body?.comment || req.body?.remark || ""),
    reason: cleanString(req.body?.reason || req.body?.rejectionReason || ""),
  };
  next();
};

module.exports = {
  validateLeaveTypePayload,
  validateLeaveApplyPayload,
  validateLeaveReview,
};
