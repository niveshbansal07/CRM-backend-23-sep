const mongoose = require("mongoose");
const {
  cleanString,
  normalizeName,
  normalizeCode,
  slugify,
  validateCustomName,
} = require("../utils/normalize");

const CONTROLLED_SYSTEM_ROLES = [
  "super_admin",
  "company_admin",
  "sub_admin",
  "hr_head",
  "hr_manager",
  "hr_general",
  "hr_executive",
  "manager",
  "employee",
  "user",
  "sales_manager",
  "sales_executive",
  "marketing_manager",
  "marketing_executive",
  "support_manager",
  "support_executive",
  "finance_manager",
  "finance_executive",
  "operations_manager",
  "operations_executive",
  "project_manager",
  "team_lead",
  "department_head",
];

const STATUS_VALUES = ["active", "inactive"];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));

const fail = (res, errors) =>
  res.status(400).json({
    success: false,
    message: "Validation failed.",
    errors,
  });

const cleanRoles = (roles) => {
  if (!Array.isArray(roles)) return [];

  return [...new Set(roles.map(cleanString).filter(Boolean))];
};

const validateAllowedRoles = (roles, errors) => {
  const invalidRoles = roles.filter((role) => !CONTROLLED_SYSTEM_ROLES.includes(role));

  if (invalidRoles.length) {
    errors.push(`Invalid allowed roles: ${invalidRoles.join(", ")}.`);
  }
};

const validateDepartmentPayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];

  const nameValidation = validateCustomName(body.name, "Department name");
  const name = nameValidation.name;
  const allowedRoles = cleanRoles(body.allowedRoles);
  const status = body.status ? cleanString(body.status).toLowerCase() : undefined;

  errors.push(...nameValidation.errors);

  if (status && !STATUS_VALUES.includes(status)) {
    errors.push("Status must be active or inactive.");
  }

  validateAllowedRoles(allowedRoles, errors);

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    name,
    normalizedName: nameValidation.normalizedName,
    slug: nameValidation.slug,
    code: normalizeCode(body.code || name),
    description: cleanString(body.description),
    allowedRoles,
    status,
  };

  next();
};

const validateDepartmentStatus = (req, res, next) => {
  const status = cleanString(req.body?.status).toLowerCase();

  if (!STATUS_VALUES.includes(status)) {
    return fail(res, ["Status must be active or inactive."]);
  }

  req.validatedBody = { status };
  next();
};

const validateObjectIdParam = (paramName = "id") => (req, res, next) => {
  if (!isValidObjectId(req.params[paramName])) {
    return fail(res, [`${paramName} must be a valid ObjectId.`]);
  }

  next();
};

const validateDefaultDepartmentSelection = (req, res, next) => {
  const body = req.body || {};
  const departmentKeys = Array.isArray(body.departmentKeys)
    ? body.departmentKeys
    : Array.isArray(body.selectedDepartments)
      ? body.selectedDepartments
      : [];

  const cleanedKeys = [...new Set(departmentKeys.map(cleanString).filter(Boolean))];

  if (!cleanedKeys.length) {
    return fail(res, ["Select at least one default department."]);
  }

  req.validatedBody = {
    departmentKeys: cleanedKeys,
  };

  next();
};

const validateDepartmentArchive = (req, res, next) => {
  const value = req.body?.isArchived ?? req.body?.archived;

  if (typeof value !== "boolean") {
    return fail(res, ["isArchived must be true or false."]);
  }

  req.validatedBody = {
    isArchived: value,
  };

  next();
};

module.exports = {
  CONTROLLED_SYSTEM_ROLES,
  STATUS_VALUES,
  cleanString,
  normalizeName,
  normalizeCode,
  slugify,
  validateCustomName,
  cleanRoles,
  validateAllowedRoles,
  validateDepartmentPayload,
  validateDepartmentStatus,
  validateDefaultDepartmentSelection,
  validateDepartmentArchive,
  validateObjectIdParam,
  isValidObjectId,
};
