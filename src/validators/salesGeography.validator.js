const mongoose = require("mongoose");
const { cleanString, normalizeCode, validateCustomName } = require("../utils/normalize");
const {
  SALES_GEOGRAPHY_TYPES,
  SALES_GEOGRAPHY_PARENT_TYPE,
  normalizeGeographyType,
} = require("../constants/salesGeography");
const INDIA_STATE_DISTRICTS = require("../data/indiaStateDistricts.json");
const INDIA_STATES = new Set(Object.keys(INDIA_STATE_DISTRICTS));

const validateStateNames = (value, errors, required = false) => {
  const names = Array.isArray(value) ? [...new Set(value.map(cleanString).filter(Boolean))] : [];
  if (required && !names.length) errors.push("Select at least one State / UT for the Zone.");
  const invalid = names.filter((name) => !INDIA_STATES.has(name));
  if (invalid.length) errors.push(`Invalid State / UT: ${invalid.join(", ")}.`);
  return names;
};

const fail = (res, errors) => res.status(400).json({
  success: false,
  message: "Validation failed.",
  errors,
});

const validateCode = (value, errors) => {
  const code = normalizeCode(value);
  if (!code) errors.push("Geography code is required.");
  if (code && (code.length < 2 || code.length > 32)) {
    errors.push("Geography code must be between 2 and 32 characters.");
  }
  return code;
};

const validateSalesGeographyCreate = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const forbidden = ["companyId", "tenantId", "organizationId", "createdBy", "updatedBy", "deletedAt"]
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  const type = normalizeGeographyType(body.type);
  const nameValidation = validateCustomName(body.name, "Geography name");
  const code = validateCode(body.code, errors);
  const parentId = cleanString(body.parentId);
  const description = cleanString(body.description);
  const stateNames = validateStateNames(body.stateNames, errors, type === "ZONE");

  errors.push(...nameValidation.errors);
  if (forbidden.length) errors.push(`Client-controlled fields are not allowed: ${forbidden.join(", ")}.`);
  if (!SALES_GEOGRAPHY_TYPES.includes(type)) {
    errors.push(`Type must be one of: ${SALES_GEOGRAPHY_TYPES.join(", ")}.`);
  }
  if (description.length > 500) errors.push("Description must be 500 characters or less.");

  const expectedParent = SALES_GEOGRAPHY_PARENT_TYPE[type];
  if (expectedParent === null && parentId) errors.push("Zone cannot have a geography parent.");
  if (expectedParent && !parentId) errors.push(`${type} requires a ${expectedParent} parent.`);
  if (parentId && !mongoose.Types.ObjectId.isValid(parentId)) {
    errors.push("Parent must be a valid ObjectId.");
  }

  if (errors.length) return fail(res, errors);
  req.validatedBody = {
    type,
    name: nameValidation.name,
    normalizedName: nameValidation.normalizedName,
    code,
    parentId: parentId || null,
    description,
    stateNames: type === "ZONE" ? stateNames : [],
  };
  next();
};

const validateSalesGeographyUpdate = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const locked = [
    "companyId", "tenantId", "organizationId", "type", "code", "parentId",
    "createdBy", "updatedBy", "status", "isActive", "isArchived", "deletedAt",
  ].filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasDescription = Object.prototype.hasOwnProperty.call(body, "description");
  const hasStateNames = Object.prototype.hasOwnProperty.call(body, "stateNames");
  const nameValidation = hasName ? validateCustomName(body.name, "Geography name") : null;
  const description = hasDescription ? cleanString(body.description) : undefined;
  const stateNames = hasStateNames ? validateStateNames(body.stateNames, errors, true) : undefined;

  if (locked.length) errors.push(`Immutable or controlled fields cannot be changed: ${locked.join(", ")}.`);
  if (nameValidation) errors.push(...nameValidation.errors);
  if (description !== undefined && description.length > 500) {
    errors.push("Description must be 500 characters or less.");
  }
  if (!hasName && !hasDescription && !hasStateNames) errors.push("Provide name, description, or State / UT mappings to update.");

  if (errors.length) return fail(res, errors);
  req.validatedBody = {
    ...(nameValidation ? { name: nameValidation.name, normalizedName: nameValidation.normalizedName } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(stateNames !== undefined ? { stateNames } : {}),
  };
  next();
};

const validateSalesGeographyStatus = (req, res, next) => {
  const status = cleanString(req.body?.status).toLowerCase();
  if (!["active", "inactive"].includes(status)) {
    return fail(res, ["Status must be active or inactive."]);
  }
  req.validatedBody = { status };
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
  validateSalesGeographyCreate,
  validateSalesGeographyUpdate,
  validateSalesGeographyStatus,
  validateObjectIdParam,
};
