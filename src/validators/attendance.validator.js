const mongoose = require("mongoose");

const OBJECT_ID_ERROR = "must be a valid ObjectId.";
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const cleanString = (value = "") => String(value || "").trim().replace(/\s+/g, " ");
const cleanArray = (value) => (Array.isArray(value) ? value : []);

const fail = (res, errors) => res.status(400).json({
  success: false,
  message: "Validation failed.",
  errors,
});

const validDate = (value) => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime());
};

const validatePolicyPayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const name = cleanString(body.name || body.policyName);

  if (!name) errors.push("Policy name is required.");

  ["fullDayMinutes", "halfDayMinutes", "graceMinutes", "breakMinutes", "lateAllowedPerMonth", "consecutiveLateLimit", "overtimeAfterMinutes"].forEach((field) => {
    if (body[field] !== undefined && Number(body[field]) < 0) {
      errors.push(`${field} must be a positive number.`);
    }
  });

  if (body.lateAfterTime && !TIME_REGEX.test(body.lateAfterTime)) {
    errors.push("lateAfterTime must use HH:mm format.");
  }

  if (body.workingDays && cleanArray(body.workingDays).some((day) => Number(day) < 0 || Number(day) > 6)) {
    errors.push("workingDays values must be 0-6.");
  }

  if (body.weeklyOffs && cleanArray(body.weeklyOffs).some((day) => Number(day) < 0 || Number(day) > 6)) {
    errors.push("weeklyOffs values must be 0-6.");
  }

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    name,
    workingDays: body.workingDays ? cleanArray(body.workingDays).map(Number) : undefined,
    weeklyOffs: body.weeklyOffs ? cleanArray(body.weeklyOffs).map(Number) : undefined,
    fullDayMinutes: body.fullDayMinutes !== undefined ? Number(body.fullDayMinutes) : undefined,
    halfDayMinutes: body.halfDayMinutes !== undefined ? Number(body.halfDayMinutes) : undefined,
    graceMinutes: body.graceMinutes !== undefined ? Number(body.graceMinutes) : undefined,
    breakMinutes: body.breakMinutes !== undefined ? Number(body.breakMinutes) : undefined,
    lateAllowedPerMonth: body.lateAllowedPerMonth !== undefined ? Number(body.lateAllowedPerMonth) : undefined,
    lateAfterTime: body.lateAfterTime,
    thirdLatePenalty: body.thirdLatePenalty,
    consecutiveLateLimit: body.consecutiveLateLimit !== undefined ? Number(body.consecutiveLateLimit) : undefined,
    afterConsecutiveLatePenalty: body.afterConsecutiveLatePenalty,
    overtimeEnabled: Boolean(body.overtimeEnabled),
    overtimeAfterMinutes: body.overtimeAfterMinutes !== undefined ? Number(body.overtimeAfterMinutes) : undefined,
    correctionAllowed: body.correctionAllowed !== undefined ? Boolean(body.correctionAllowed) : undefined,
    isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
    status: body.status,
  };
  next();
};

const validateShiftPayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const name = cleanString(body.name || body.shiftName);

  if (!name) errors.push("Shift name is required.");
  if (!TIME_REGEX.test(body.startTime || "")) errors.push("startTime must use HH:mm format.");
  if (!TIME_REGEX.test(body.endTime || "")) errors.push("endTime must use HH:mm format.");

  ["graceMinutes", "breakMinutes", "fullDayMinutes", "halfDayMinutes"].forEach((field) => {
    if (body[field] !== undefined && Number(body[field]) < 0) {
      errors.push(`${field} must be a positive number.`);
    }
  });

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    name,
    startTime: body.startTime,
    endTime: body.endTime,
    graceMinutes: body.graceMinutes !== undefined ? Number(body.graceMinutes) : undefined,
    breakMinutes: body.breakMinutes !== undefined ? Number(body.breakMinutes) : undefined,
    fullDayMinutes: body.fullDayMinutes !== undefined ? Number(body.fullDayMinutes) : undefined,
    halfDayMinutes: body.halfDayMinutes !== undefined ? Number(body.halfDayMinutes) : undefined,
    isNightShift: Boolean(body.isNightShift),
    isFlexible: Boolean(body.isFlexible),
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
  };
  next();
};

const validateShiftAssignment = (req, res, next) => {
  const body = req.body || {};
  const errors = [];

  if (!isValidObjectId(body.employeeId)) errors.push(`employeeId ${OBJECT_ID_ERROR}`);
  if (!isValidObjectId(body.shiftId)) errors.push(`shiftId ${OBJECT_ID_ERROR}`);
  if (!validDate(body.effectiveFrom)) errors.push("effectiveFrom is required and must be a valid date.");
  if (body.effectiveTo && !validDate(body.effectiveTo)) errors.push("effectiveTo must be a valid date.");

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    employeeId: body.employeeId,
    shiftId: body.shiftId,
    effectiveFrom: new Date(body.effectiveFrom),
    effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : null,
  };
  next();
};

const validateHolidayCalendar = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const name = cleanString(body.name);
  const year = Number(body.year);
  const holidays = cleanArray(body.holidays);

  if (!name) errors.push("Calendar name is required.");
  if (!year || year < 2000 || year > 2100) errors.push("A valid year is required.");
  holidays.forEach((holiday, index) => {
    if (!cleanString(holiday.name)) errors.push(`Holiday ${index + 1} name is required.`);
    if (!validDate(holiday.date)) errors.push(`Holiday ${index + 1} date is invalid.`);
  });

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    name,
    year,
    holidays: holidays.map((holiday) => ({
      name: cleanString(holiday.name),
      date: new Date(holiday.date),
      type: holiday.type || "COMPANY",
      isPaid: holiday.isPaid !== undefined ? Boolean(holiday.isPaid) : true,
    })),
  };
  next();
};

const validateCorrectionRequest = (req, res, next) => {
  const body = req.body || {};
  const errors = [];

  const allowedTypes = ["MISSED_PUNCH_IN", "MISSED_PUNCH_OUT", "WRONG_PUNCH_TIME", "WORK_FROM_HOME", "ON_DUTY", "CLIENT_VISIT", "MANUAL_PRESENT"];
  if (!validDate(body.date)) errors.push("date is required and must be valid.");
  if (!allowedTypes.includes(body.type)) errors.push("Correction type is invalid.");
  if (!cleanString(body.reason)) errors.push("Reason is required.");
  if (body.attendanceId && !isValidObjectId(body.attendanceId)) errors.push(`attendanceId ${OBJECT_ID_ERROR}`);
  if (body.requestedPunchIn && !validDate(body.requestedPunchIn)) errors.push("requestedPunchIn must be a valid date-time.");
  if (body.requestedPunchOut && !validDate(body.requestedPunchOut)) errors.push("requestedPunchOut must be a valid date-time.");

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    attendanceId: body.attendanceId || null,
    date: new Date(body.date),
    type: body.type,
    requestedPunchIn: body.requestedPunchIn ? new Date(body.requestedPunchIn) : null,
    requestedPunchOut: body.requestedPunchOut ? new Date(body.requestedPunchOut) : null,
    reason: cleanString(body.reason),
    attachmentUrl: cleanString(body.attachmentUrl),
  };
  next();
};

const validateReview = (req, res, next) => {
  req.validatedBody = {
    comment: cleanString(req.body?.comment || req.body?.remark || ""),
    reason: cleanString(req.body?.reason || req.body?.rejectionReason || ""),
  };
  next();
};

const validateDateQuery = (req, res, next) => {
  if (req.query.date && !DATE_REGEX.test(String(req.query.date))) {
    return fail(res, ["date must use YYYY-MM-DD format."]);
  }
  next();
};

const validateObjectIdParam = (paramName = "id") => (req, res, next) => {
  if (!isValidObjectId(req.params[paramName])) {
    return fail(res, [`${paramName} ${OBJECT_ID_ERROR}`]);
  }
  next();
};

module.exports = {
  validatePolicyPayload,
  validateShiftPayload,
  validateShiftAssignment,
  validateHolidayCalendar,
  validateCorrectionRequest,
  validateReview,
  validateDateQuery,
  validateObjectIdParam,
  isValidObjectId,
};
