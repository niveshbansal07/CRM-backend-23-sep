const mongoose = require("mongoose");
const { cleanString } = require("../utils/normalize");

const FORBIDDEN_FIELDS = [
  "companyId",
  "departmentId",
  "designationId",
  "role",
  "systemRole",
  "mappedRole",
  "permissionScope",
  "customPermissions",
  "managerId",
  "reportingManagerId",
  "status",
  "isActive",
  "setupCompleted",
  "setupCompletedAt",
  "isEmailVerified",
];

const fail = (res, errors) =>
  res.status(400).json({
    success: false,
    message: "Validation failed.",
    errors,
  });

const validateHodDepartmentId = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.departmentId || ""))) {
    return fail(res, ["Department id must be a valid ObjectId."]);
  }

  return next();
};

const validateHodSetupPayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const attemptedForbiddenFields = FORBIDDEN_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  );

  if (attemptedForbiddenFields.length) {
    errors.push(`These fields are controlled by the server: ${attemptedForbiddenFields.join(", ")}.`);
  }

  const fullName = cleanString(body.fullName);
  const email = cleanString(body.email).toLowerCase();
  const password = String(body.password || "");
  const phone = cleanString(body.phone);
  const employeeId = cleanString(body.employeeId);
  const joiningDateText = cleanString(body.joiningDate);
  const joiningDate = joiningDateText ? new Date(joiningDateText) : null;

  if (!fullName) errors.push("Full name is required.");
  if (fullName && fullName.length > 120) errors.push("Full name must be 120 characters or less.");
  if (!email) errors.push("Work email is required.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Work email is invalid.");
  if (!password) errors.push("Temporary password is required.");
  if (password && password.length < 6) errors.push("Temporary password must be at least 6 characters.");
  if (!phone) errors.push("Company phone is required.");
  if (!employeeId) errors.push("Employee ID is required.");
  if (!joiningDateText) errors.push("Joining date is required.");
  if (joiningDateText && Number.isNaN(joiningDate.getTime())) errors.push("Joining date is invalid.");

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    fullName,
    email,
    password,
    phone,
    employeeId,
    joiningDate,
  };

  return next();
};

module.exports = {
  FORBIDDEN_FIELDS,
  validateHodDepartmentId,
  validateHodSetupPayload,
};
