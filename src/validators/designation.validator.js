const {
  STATUS_VALUES,
  cleanString,
  normalizeName,
  normalizeCode,
  slugify,
  validateCustomName,
  cleanRoles,
  validateAllowedRoles,
  validateObjectIdParam,
  isValidObjectId,
} = require("./department.validator");

const fail = (res, errors) =>
  res.status(400).json({
    success: false,
    message: "Validation failed.",
    errors,
  });

const validateDesignationPayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];

  const nameValidation = validateCustomName(body.title || body.name, "Designation title");
  const name = nameValidation.name;
  const departmentId = cleanString(body.departmentId);
  const mappedRole = cleanString(body.mappedRole);
  const allowedRoles = cleanRoles(body.allowedRoles);
  const hierarchyLevel = Number(body.hierarchyLevel);
  const status = body.status ? cleanString(body.status).toLowerCase() : undefined;
  const allowedParentLevels = Array.isArray(body.allowedParentLevels)
    ? [...new Set(
      body.allowedParentLevels
        .map((level) => Number(level))
        .filter((level) => Number.isInteger(level) && level >= 1 && level <= 6)
    )]
    : [];

  errors.push(...nameValidation.errors);

  if (!departmentId) {
    errors.push("Department is required.");
  } else if (!isValidObjectId(departmentId)) {
    errors.push("Department must be a valid ObjectId.");
  }

  if (!Number.isInteger(hierarchyLevel) || hierarchyLevel < 1 || hierarchyLevel > 6) {
    errors.push("Hierarchy level must be an integer between L1 and L6.");
  }

  if (status && !STATUS_VALUES.includes(status)) {
    errors.push("Status must be active or inactive.");
  }

  validateAllowedRoles(mappedRole ? [mappedRole] : [], errors);
  validateAllowedRoles(allowedRoles, errors);

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    name,
    title: name,
    normalizedName: nameValidation.normalizedName,
    normalizedTitle: nameValidation.normalizedName,
    slug: nameValidation.slug,
    code: normalizeCode(body.code || name),
    description: cleanString(body.description),
    departmentId,
    mappedRole: "",
    allowedRoles: [],
    hierarchyLevel,
    allowedParentLevels,
    canManagePeople: false,
    isLeadership: false,
    status,
  };

  next();
};

const validateDesignationUpdatePayload = (req, res, next) => {
  const body = req.body || {};
  const errors = [];
  const lockedFields = [
    "name",
    "title",
    "code",
    "departmentId",
    "hierarchyLevel",
    "mappedRole",
    "allowedRoles",
    "allowedParentLevels",
    "canManagePeople",
    "isLeadership",
    "source",
    "isDefaultSeed",
    "slug",
    "normalizedName",
    "normalizedTitle",
  ];
  const attemptedLockedFields = lockedFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field)
  );
  const description =
    Object.prototype.hasOwnProperty.call(body, "description")
      ? cleanString(body.description)
      : undefined;
  const status = body.status ? cleanString(body.status).toLowerCase() : undefined;

  if (attemptedLockedFields.length) {
    errors.push(
      `Designation identity fields cannot be changed after creation: ${attemptedLockedFields.join(", ")}.`
    );
  }

  if (status && !STATUS_VALUES.includes(status)) {
    errors.push("Status must be active or inactive.");
  }

  if (description === undefined && !status) {
    errors.push("Provide description or status to update.");
  }

  if (errors.length) return fail(res, errors);

  req.validatedBody = {
    ...(description !== undefined ? { description } : {}),
    ...(status ? { status } : {}),
  };

  next();
};

const validateDesignationStatus = (req, res, next) => {
  const status = cleanString(req.body?.status).toLowerCase();

  if (!STATUS_VALUES.includes(status)) {
    return fail(res, ["Status must be active or inactive."]);
  }

  req.validatedBody = { status };
  next();
};

const validateDefaultDesignationSelection = (req, res, next) => {
  const body = req.body || {};
  const departmentId = cleanString(body.departmentId);
  const designationKeys = Array.isArray(body.designationKeys)
    ? body.designationKeys
    : Array.isArray(body.selectedDesignations)
      ? body.selectedDesignations
      : [];

  const cleanedKeys = [...new Set(designationKeys.map(cleanString).filter(Boolean))];

  if (!departmentId) {
    return fail(res, ["Department is required."]);
  }

  if (!isValidObjectId(departmentId)) {
    return fail(res, ["Department must be a valid ObjectId."]);
  }

  if (!cleanedKeys.length) {
    return fail(res, ["Select at least one default designation."]);
  }

  req.validatedBody = {
    departmentId,
    designationKeys: cleanedKeys,
  };

  next();
};

const validateDesignationArchive = (req, res, next) => {
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
  validateDesignationPayload,
  validateDesignationUpdatePayload,
  validateDesignationStatus,
  validateDefaultDesignationSelection,
  validateDesignationArchive,
  validateObjectIdParam,
};
