const Department = require("../models/Department");
const Designation = require("../models/Designation");
const ApiError = require("../utils/ApiError");
const { getCompanyIdOrThrow } = require("./tenant.service");
const { READ_ROLES, MANAGE_ROLES } = require("./department.service");
const { slugify } = require("../utils/normalize");
const { getDefaultDesignationSeedsForDepartment } = require("../seeds/defaultDesignationsByDepartment");
const { canManageDesignations, canReadOrgStructure } = require("./permission.service");
const { getAccessRole } = require("../utils/roleAccess");

const buildCompanyScopedQuery = (user, extra = {}) => {
  const query = {
    deletedAt: null,
    ...extra,
  };

  if (getAccessRole(user) !== "super_admin") {
    query.companyId = getCompanyIdOrThrow(user);
  }

  return query;
};

const isHrHead = (user) => getAccessRole(user) === "hr_head";

const applyHrHeadDesignationScope = async ({ user, extra }) => {
  if (!isHrHead(user)) return extra;

  const hrDepartmentId = user.departmentId;
  if (!hrDepartmentId) {
    throw new ApiError(403, "HR Head department context is missing.");
  }

  if (extra.departmentId && String(extra.departmentId) !== String(hrDepartmentId)) {
    throw new ApiError(403, "HR Head can view Human Resource designations only.");
  }

  return {
    ...extra,
    departmentId: hrDepartmentId,
  };
};

const assertCanReadDesignations = (user) => {
  if (!user || !canReadOrgStructure(user)) {
    throw new ApiError(403, "Access denied");
  }
};

const assertCanManageDesignations = (user) => {
  if (!user || !canManageDesignations(user)) {
    throw new ApiError(403, "Access denied");
  }

  return getCompanyIdOrThrow(user);
};

const mapDesignation = (designation) => ({
  id: designation._id,
  _id: designation._id,
  companyId: designation.companyId,
  departmentId: designation.departmentId,
  name: designation.name,
  title: designation.title || designation.name,
  normalizedName: designation.normalizedName,
  normalizedTitle: designation.normalizedTitle || designation.normalizedName,
  slug: designation.slug || slugify(designation.title || designation.name),
  code: designation.code,
  description: designation.description,
  mappedRole: designation.mappedRole,
  allowedRoles: designation.allowedRoles || [],
  hierarchyLevel: designation.hierarchyLevel,
  allowedParentLevels: designation.allowedParentLevels || [],
  canManagePeople: designation.canManagePeople,
  isLeadership: designation.isLeadership,
  isDepartmentHead: designation.isDepartmentHead === true,
  isHead: designation.isHead === true,
  status: designation.status,
  source: designation.source || "custom",
  isDefaultSeed: designation.isDefaultSeed === true,
  isActive: designation.isActive !== false && designation.status === "active",
  isArchived: designation.isArchived === true,
  archivedAt: designation.archivedAt,
  createdBy: designation.createdBy,
  updatedBy: designation.updatedBy,
  createdAt: designation.createdAt,
  updatedAt: designation.updatedAt,
});

const mapDefaultDesignationSeed = (seed, existingDesignation = null) => ({
  ...seed,
  alreadyExists: Boolean(existingDesignation),
  designation: existingDesignation ? mapDesignation(existingDesignation) : null,
});

const isDuplicateKeyError = (error) =>
  error?.code === 11000 ||
  (Array.isArray(error?.writeErrors) &&
    error.writeErrors.some((writeError) => writeError?.code === 11000));

const designationDuplicateError = (designation) =>
  new ApiError(409, "Designation already exists in this department", [
    {
      field: "title",
      existing: designation ? mapDesignation(designation) : null,
    },
  ]);

const findDepartmentForUser = async ({ departmentId, user, requireActive = false }) => {
  const query = buildCompanyScopedQuery(user, { _id: departmentId });

  if (requireActive) {
    query.status = "active";
    query.isArchived = { $ne: true };
  }

  const department = await Department.findOne(query);

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  return department;
};

const assertRoleAllowedForDepartment = ({ department, mappedRole, allowedRoles }) => {
  const departmentRoles = department.allowedRoles || [];
  const rolesToCheck = [
    ...(mappedRole ? [mappedRole] : []),
    ...(Array.isArray(allowedRoles) ? allowedRoles : []),
  ];

  const invalidRoles = rolesToCheck.filter((role) => !departmentRoles.includes(role));

  if (invalidRoles.length) {
    throw new ApiError(
      400,
      `Role is not allowed for this department: ${invalidRoles.join(", ")}`
    );
  }
};

const listDesignations = async ({ user, departmentId = null, activeOnly = false }) => {
  assertCanReadDesignations(user);

  const extra = {};
  if (departmentId) extra.departmentId = departmentId;
  if (activeOnly) {
    extra.status = "active";
    extra.isArchived = { $ne: true };
  }

  const scopedExtra = await applyHrHeadDesignationScope({ user, extra });

  const designations = await Designation.find(buildCompanyScopedQuery(user, scopedExtra))
    .populate("departmentId", "name code status")
    .sort({ hierarchyLevel: 1, name: 1 });

  return designations.map(mapDesignation);
};

const getAvailableDefaultDesignations = async ({ departmentId, user }) => {
  const department = await findDepartmentForUser({
    departmentId,
    user,
    requireActive: true,
  });

  assertCanManageDesignations(user);

  const seeds = getDefaultDesignationSeedsForDepartment(department);
  const existingDesignations = await Designation.find({
    companyId: department.companyId,
    departmentId: department._id,
    $or: [
      { normalizedTitle: { $in: seeds.map((designation) => designation.normalizedTitle) } },
      { normalizedName: { $in: seeds.map((designation) => designation.normalizedName) } },
      { slug: { $in: seeds.map((designation) => designation.slug) } },
    ],
    deletedAt: null,
  });

  const existingByTitle = new Map(
    existingDesignations.flatMap((designation) => [
      [designation.normalizedTitle || designation.normalizedName, designation],
      [designation.normalizedName, designation],
      [designation.slug, designation],
    ])
  );

  return {
    department: {
      id: department._id,
      _id: department._id,
      name: department.name,
      slug: department.slug,
      code: department.code,
    },
    designations: seeds.map((seed) =>
      mapDefaultDesignationSeed(
        seed,
        existingByTitle.get(seed.normalizedTitle) || existingByTitle.get(seed.slug)
      )
    ),
  };
};

const getDesignationById = async ({ designationId, user }) => {
  assertCanReadDesignations(user);

  const extra = await applyHrHeadDesignationScope({
    user,
    extra: { _id: designationId },
  });

  const designation = await Designation.findOne(buildCompanyScopedQuery(user, extra)).populate(
    "departmentId",
    "name code status"
  );

  if (!designation) {
    throw new ApiError(404, "Designation not found");
  }

  return mapDesignation(designation);
};

const createDesignation = async ({ payload, user }) => {
  const companyId = assertCanManageDesignations(user);
  const department = await findDepartmentForUser({
    departmentId: payload.departmentId,
    user,
    requireActive: true,
  });

  assertRoleAllowedForDepartment({
    department,
    mappedRole: payload.mappedRole,
    allowedRoles: payload.allowedRoles,
  });

  const duplicate = await Designation.findOne({
    companyId,
    departmentId: department._id,
    $or: [
      { normalizedTitle: payload.normalizedTitle || payload.normalizedName },
      { normalizedName: payload.normalizedName },
      { slug: payload.slug },
    ],
    deletedAt: null,
  });

  if (duplicate) {
    throw designationDuplicateError(duplicate);
  }

  try {
    const designation = await Designation.create({
      companyId,
      departmentId: department._id,
      name: payload.name,
      title: payload.title || payload.name,
      normalizedName: payload.normalizedName,
      normalizedTitle: payload.normalizedTitle || payload.normalizedName,
      slug: payload.slug,
      code: payload.code,
      description: payload.description,
      mappedRole: payload.mappedRole,
      allowedRoles: payload.allowedRoles,
      hierarchyLevel: payload.hierarchyLevel,
      allowedParentLevels: payload.allowedParentLevels || [],
      canManagePeople: payload.canManagePeople,
      isLeadership: payload.isLeadership,
      status: payload.status || "active",
      source: payload.source || "custom",
      isDefaultSeed: payload.source === "default" || payload.isDefaultSeed === true,
      isActive: (payload.status || "active") === "active",
      isArchived: false,
      createdBy: user._id,
      updatedBy: user._id,
    });

    return mapDesignation(designation);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await Designation.findOne({
        companyId,
        departmentId: department._id,
        $or: [
          { normalizedTitle: payload.normalizedTitle || payload.normalizedName },
          { normalizedName: payload.normalizedName },
          { slug: payload.slug },
        ],
        deletedAt: null,
      });
      throw designationDuplicateError(existing);
    }

    throw error;
  }
};

const updateDesignation = async ({ designationId, payload, user }) => {
  const companyId = assertCanManageDesignations(user);

  const designation = await Designation.findOne({
    _id: designationId,
    companyId,
    deletedAt: null,
  });

  if (!designation) {
    throw new ApiError(404, "Designation not found");
  }

  if (Object.prototype.hasOwnProperty.call(payload, "description")) {
    designation.description = payload.description;
  }

  if (payload.status) {
    designation.status = payload.status;
    designation.isActive = payload.status === "active";
    if (payload.status === "active") {
      designation.isArchived = false;
      designation.archivedAt = null;
    }
  }

  designation.updatedBy = user._id;
  await designation.save({ validateModifiedOnly: true });

  return mapDesignation(designation);
};

const updateDesignationStatus = async ({ designationId, status, user }) => {
  const companyId = assertCanManageDesignations(user);

  const designation = await Designation.findOne({
    _id: designationId,
    companyId,
    deletedAt: null,
  });

  if (!designation) {
    throw new ApiError(404, "Designation not found");
  }

  designation.status = status;
  designation.isActive = status === "active";
  if (status === "active") {
    designation.isArchived = false;
    designation.archivedAt = null;
  }
  designation.updatedBy = user._id;
  await designation.save({ validateModifiedOnly: true });

  return mapDesignation(designation);
};

const bulkCreateDefaultDesignations = async ({ departmentId, designationKeys, user }) => {
  const companyId = assertCanManageDesignations(user);
  const department = await findDepartmentForUser({
    departmentId,
    user,
    requireActive: true,
  });

  const selectedKeys = new Set(designationKeys);
  const selectedSeeds = getDefaultDesignationSeedsForDepartment(department).filter(
    (designation) =>
      selectedKeys.has(designation.key) ||
      selectedKeys.has(designation.slug) ||
      selectedKeys.has(designation.title)
  );

  if (!selectedSeeds.length) {
    throw new ApiError(400, "No valid default designations selected");
  }

  const existingDesignations = await Designation.find({
    companyId,
    departmentId: department._id,
    $or: [
      { normalizedTitle: { $in: selectedSeeds.map((designation) => designation.normalizedTitle) } },
      { normalizedName: { $in: selectedSeeds.map((designation) => designation.normalizedName) } },
      { slug: { $in: selectedSeeds.map((designation) => designation.slug) } },
    ],
    deletedAt: null,
  });

  const existingByTitle = new Map(
    existingDesignations.flatMap((designation) => [
      [designation.normalizedTitle || designation.normalizedName, designation],
      [designation.normalizedName, designation],
      [designation.slug, designation],
    ])
  );

  const designationsToCreate = selectedSeeds
    .filter((designation) => !existingByTitle.has(designation.normalizedTitle) && !existingByTitle.has(designation.slug))
    .map((designation) => ({
      companyId,
      departmentId: department._id,
      name: designation.title,
      title: designation.title,
      normalizedName: designation.normalizedTitle,
      normalizedTitle: designation.normalizedTitle,
      slug: designation.slug,
      code: designation.code,
      description: "",
      mappedRole: designation.mappedRole || "",
      allowedRoles: designation.allowedRoles || [],
      hierarchyLevel: designation.hierarchyLevel,
      allowedParentLevels: designation.allowedParentLevels || [],
      canManagePeople: designation.canManagePeople === true,
      isLeadership: designation.isLeadership === true,
      isDepartmentHead: designation.isDepartmentHead === true,
      isHead: designation.isHead === true,
      status: "active",
      source: "default",
      isDefaultSeed: true,
      isActive: true,
      isArchived: false,
      createdBy: user._id,
      updatedBy: user._id,
    }));

  let createdDesignations = [];

  try {
    createdDesignations = designationsToCreate.length
      ? await Designation.insertMany(designationsToCreate, { ordered: false })
      : [];
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
  }

  return {
    department: {
      id: department._id,
      _id: department._id,
      name: department.name,
      slug: department.slug,
      code: department.code,
    },
    created: createdDesignations.map(mapDesignation),
    skippedExisting: selectedSeeds
      .filter((designation) => existingByTitle.has(designation.normalizedTitle) || existingByTitle.has(designation.slug))
      .map((designation) =>
        mapDefaultDesignationSeed(
          designation,
          existingByTitle.get(designation.normalizedTitle) || existingByTitle.get(designation.slug)
        )
      ),
  };
};

const archiveDesignation = async ({ designationId, isArchived, user }) => {
  const companyId = assertCanManageDesignations(user);

  const designation = await Designation.findOne({
    _id: designationId,
    companyId,
    deletedAt: null,
  });

  if (!designation) {
    throw new ApiError(404, "Designation not found");
  }

  designation.isArchived = isArchived;
  designation.isActive = !isArchived;
  designation.status = isArchived ? "inactive" : "active";
  designation.archivedAt = isArchived ? new Date() : null;
  designation.updatedBy = user._id;
  await designation.save({ validateModifiedOnly: true });

  return mapDesignation(designation);
};

module.exports = {
  mapDesignation,
  listDesignations,
  getAvailableDefaultDesignations,
  getDesignationById,
  createDesignation,
  updateDesignation,
  updateDesignationStatus,
  bulkCreateDefaultDesignations,
  archiveDesignation,
};
