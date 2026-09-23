const Department = require("../models/Department");
const ApiError = require("../utils/ApiError");
const Designation = require("../models/Designation");
const { getCompanyIdOrThrow } = require("./tenant.service");
const { DEFAULT_DEPARTMENTS } = require("../seeds/defaultDepartments");
const { getDefaultDesignationSeedsForDepartment } = require("../seeds/defaultDesignationsByDepartment");
const { normalizeCode, normalizeName, slugify } = require("../utils/normalize");
const { canManageDepartments, canReadOrgStructure } = require("./permission.service");
const { getAccessRole } = require("../utils/roleAccess");

const READ_ROLES = [
  "super_admin",
  "company_admin",
  "sub_admin",
  "hr_head",
  "hr_manager",
  "hr_general",
  "hr_executive",
];

const MANAGE_ROLES = ["company_admin", "sub_admin"];
const HR_DEPARTMENT_NAMES = ["human resource", "human resources"];
const HR_DEPARTMENT_SLUGS = ["human-resource", "human-resources"];

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

const applyHrHeadDepartmentScope = (query, user) => {
  if (!isHrHead(user)) return query;

  if (user.departmentId) {
    query._id = user.departmentId;
    return query;
  }

  query.$or = [
    { normalizedName: { $in: HR_DEPARTMENT_NAMES } },
    { slug: { $in: HR_DEPARTMENT_SLUGS } },
    { normalizedName: normalizeName("Human Resource") },
  ];

  return query;
};

const assertCanReadDepartments = (user) => {
  if (!user || !canReadOrgStructure(user)) {
    throw new ApiError(403, "Access denied");
  }
};

const assertCanManageDepartments = (user) => {
  if (!user || !canManageDepartments(user)) {
    throw new ApiError(403, "Access denied");
  }

  return getCompanyIdOrThrow(user);
};

const mapDepartment = (department) => ({
  id: department._id,
  _id: department._id,
  companyId: department.companyId,
  name: department.name,
  normalizedName: department.normalizedName,
  slug: department.slug || slugify(department.name),
  code: department.code,
  description: department.description,
  allowedRoles: department.allowedRoles || [],
  status: department.status,
  source: department.source || "custom",
  isDefaultSeed: Boolean(department.isDefaultSeed || department.isSystemDefault),
  isActive: department.isActive !== false && department.status === "active",
  isArchived: department.isArchived === true,
  isSystemDefault: department.isSystemDefault,
  archivedAt: department.archivedAt,
  createdBy: department.createdBy,
  updatedBy: department.updatedBy,
  createdAt: department.createdAt,
  updatedAt: department.updatedAt,
});

const mapDefaultDepartmentSeed = (seed, existingDepartment = null) => ({
  ...seed,
  alreadyExists: Boolean(existingDepartment),
  department: existingDepartment ? mapDepartment(existingDepartment) : null,
});

const isDuplicateKeyError = (error) =>
  error?.code === 11000 ||
  (Array.isArray(error?.writeErrors) &&
    error.writeErrors.some((writeError) => writeError?.code === 11000));

const departmentDuplicateError = (department) =>
  new ApiError(409, "Department already exists in this company", [
    {
      field: "name",
      existing: department ? mapDepartment(department) : null,
    },
  ]);

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getHeadDesignationTitle = (department) => {
  const departmentName = String(department?.name || "").trim().replace(/\s+/g, " ");
  const defaultHeadSeed = getDefaultDesignationSeedsForDepartment(department).find((seed) =>
    /\b(head|hod)\b/i.test(seed.title || seed.name || "")
  );

  if (defaultHeadSeed?.title || defaultHeadSeed?.name) {
    return defaultHeadSeed.title || defaultHeadSeed.name;
  }

  const normalizedDepartmentName = normalizeName(departmentName);

  if (["hr", "human resource", "human resources"].includes(normalizedDepartmentName)) {
    return "Head of HR";
  }

  if (["it", "it technical", "information technology", "technical"].includes(normalizedDepartmentName)) {
    return "Head of IT";
  }

  return `Head of ${departmentName}`;
};

const mapHeadDesignation = (designation) => ({
  id: designation._id,
  _id: designation._id,
  departmentId: designation.departmentId,
  name: designation.name,
  title: designation.title || designation.name,
  hierarchyLevel: designation.hierarchyLevel,
  isDepartmentHead: designation.isDepartmentHead === true,
  isHead: designation.isHead === true,
});

const markDesignationAsDepartmentHead = async ({ designation, userId }) => {
  let changed = false;

  if (designation.isDepartmentHead !== true) {
    designation.isDepartmentHead = true;
    changed = true;
  }

  if (designation.isHead !== true) {
    designation.isHead = true;
    changed = true;
  }

  if (!designation.hierarchyLevel || designation.hierarchyLevel < 6) {
    designation.hierarchyLevel = 6;
    changed = true;
  }

  if (designation.canManagePeople !== true) {
    designation.canManagePeople = true;
    changed = true;
  }

  if (designation.isLeadership !== true) {
    designation.isLeadership = true;
    changed = true;
  }

  if (!Array.isArray(designation.allowedRoles) || !designation.allowedRoles.includes("employee")) {
    designation.allowedRoles = [...new Set([...(designation.allowedRoles || []), "employee"])];
    changed = true;
  }

  if (designation.status !== "active" || designation.isActive === false || designation.isArchived === true) {
    designation.status = "active";
    designation.isActive = true;
    designation.isArchived = false;
    designation.archivedAt = null;
    changed = true;
  }

  if (changed) {
    designation.updatedBy = userId || designation.updatedBy;
    await designation.save({ validateModifiedOnly: true });
  }

  return designation;
};

const ensureHeadDesignationForDepartment = async ({ companyId, department, userId = null }) => {
  if (!companyId || !department?._id) return null;

  const title = getHeadDesignationTitle(department);
  const normalizedTitle = normalizeName(title);
  const slug = slugify(title);
  const exactTitle = new RegExp(`^${escapeRegex(title)}$`, "i");

  const existingHead = await Designation.findOne({
    companyId,
    departmentId: department._id,
    deletedAt: null,
    $or: [
      { isDepartmentHead: true },
      { isHead: true },
      { normalizedName: normalizedTitle },
      { normalizedTitle },
      { slug },
      { name: exactTitle },
      { title: exactTitle },
    ],
  });

  if (existingHead) {
    return markDesignationAsDepartmentHead({ designation: existingHead, userId });
  }

  try {
    return await Designation.create({
      companyId,
      departmentId: department._id,
      name: title,
      title,
      normalizedName: normalizedTitle,
      normalizedTitle,
      slug,
      code: normalizeCode(`HOD_${department.code || department.slug || department.name}`).slice(0, 32),
      description: `Default Head of Department designation for ${department.name}.`,
      mappedRole: "",
      allowedRoles: ["employee"],
      hierarchyLevel: 6,
      allowedParentLevels: [],
      canManagePeople: true,
      isLeadership: true,
      isDepartmentHead: true,
      isHead: true,
      status: "active",
      source: department.source === "default" || department.isDefaultSeed === true ? "default" : "custom",
      isDefaultSeed: department.source === "default" || department.isDefaultSeed === true,
      isActive: true,
      isArchived: false,
      createdBy: userId,
      updatedBy: userId,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const duplicate = await Designation.findOne({
      companyId,
      departmentId: department._id,
      deletedAt: null,
      $or: [
        { normalizedName: normalizedTitle },
        { normalizedTitle },
        { slug },
        { name: exactTitle },
        { title: exactTitle },
      ],
    });

    if (!duplicate) {
      throw error;
    }

    return markDesignationAsDepartmentHead({ designation: duplicate, userId });
  }
};

const listDepartments = async ({ user, activeOnly = false }) => {
  assertCanReadDepartments(user);

  const query = buildCompanyScopedQuery(
    user,
    activeOnly ? { status: "active", isArchived: { $ne: true } } : {}
  );
  applyHrHeadDepartmentScope(query, user);
  const departments = await Department.find(query).sort({ name: 1 });

  return departments.map(mapDepartment);
};

const getAvailableDefaultDepartments = async ({ user }) => {
  const companyId = assertCanManageDepartments(user);
  const existingDepartments = await Department.find({
    companyId,
    $or: [
      {
        normalizedName: {
          $in: DEFAULT_DEPARTMENTS.map((department) => department.normalizedName),
        },
      },
      {
        slug: {
          $in: DEFAULT_DEPARTMENTS.map((department) => department.slug),
        },
      },
    ],
    deletedAt: null,
  });

  const existingByName = new Map(
    existingDepartments.flatMap((department) => [
      [department.normalizedName, department],
      [department.slug, department],
    ])
  );

  return DEFAULT_DEPARTMENTS.map((seed) =>
    mapDefaultDepartmentSeed(seed, existingByName.get(seed.normalizedName) || existingByName.get(seed.slug))
  );
};

const getDepartmentById = async ({ departmentId, user }) => {
  assertCanReadDepartments(user);

  const department = await Department.findOne(
    buildCompanyScopedQuery(user, { _id: departmentId })
  );

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  return mapDepartment(department);
};

const createDepartment = async ({ payload, user }) => {
  const companyId = assertCanManageDepartments(user);

  const duplicate = await Department.findOne({
    companyId,
    $or: [
      { normalizedName: payload.normalizedName },
      { slug: payload.slug },
    ],
    deletedAt: null,
  });

  if (duplicate) {
    throw departmentDuplicateError(duplicate);
  }

  try {
    const department = await Department.create({
      companyId,
      name: payload.name,
      normalizedName: payload.normalizedName,
      slug: payload.slug,
      code: payload.code,
      description: payload.description,
      allowedRoles: payload.allowedRoles.length ? payload.allowedRoles : ["employee"],
      status: payload.status || "active",
      source: payload.source || "custom",
      isDefaultSeed: payload.source === "default" || payload.isDefaultSeed === true,
      isSystemDefault: payload.source === "default" || payload.isDefaultSeed === true,
      isActive: (payload.status || "active") === "active",
      isArchived: false,
      createdBy: user._id,
      updatedBy: user._id,
    });

    await ensureHeadDesignationForDepartment({
      companyId,
      department,
      userId: user._id,
    });

    return mapDepartment(department);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await Department.findOne({
        companyId,
        $or: [
          { normalizedName: payload.normalizedName },
          { slug: payload.slug },
        ],
        deletedAt: null,
      });
      throw departmentDuplicateError(existing);
    }

    throw error;
  }
};

const updateDepartment = async ({ departmentId, payload, user }) => {
  const companyId = assertCanManageDepartments(user);

  const department = await Department.findOne({
    _id: departmentId,
    companyId,
    deletedAt: null,
  });

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  if (payload.normalizedName && payload.normalizedName !== department.normalizedName) {
    const duplicate = await Department.findOne({
      _id: { $ne: department._id },
      companyId,
      $or: [
        { normalizedName: payload.normalizedName },
        { slug: payload.slug },
      ],
      deletedAt: null,
    });

    if (duplicate) {
      throw departmentDuplicateError(duplicate);
    }
  }

  department.name = payload.name;
  department.normalizedName = payload.normalizedName;
  department.slug = payload.slug;
  department.code = payload.code;
  department.description = payload.description;
  department.allowedRoles = payload.allowedRoles.length ? payload.allowedRoles : ["employee"];

  if (payload.status) {
    department.status = payload.status;
    department.isActive = payload.status === "active";
    if (payload.status === "active") {
      department.isArchived = false;
      department.archivedAt = null;
    }
  }

  department.updatedBy = user._id;
  try {
    await department.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await Department.findOne({
        _id: { $ne: department._id },
        companyId,
        $or: [
          { normalizedName: payload.normalizedName },
          { slug: payload.slug },
        ],
        deletedAt: null,
      });
      throw departmentDuplicateError(existing);
    }

    throw error;
  }

  return mapDepartment(department);
};

const updateDepartmentStatus = async ({ departmentId, status, user }) => {
  const companyId = assertCanManageDepartments(user);

  const department = await Department.findOne({
    _id: departmentId,
    companyId,
    deletedAt: null,
  });

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  department.status = status;
  department.isActive = status === "active";
  if (status === "active") {
    department.isArchived = false;
    department.archivedAt = null;
  }
  department.updatedBy = user._id;
  await department.save();

  return mapDepartment(department);
};

const bulkCreateDefaultDepartments = async ({ departmentKeys, user }) => {
  const companyId = assertCanManageDepartments(user);
  const selectedKeys = new Set(departmentKeys);
  const selectedSeeds = DEFAULT_DEPARTMENTS.filter(
    (department) =>
      selectedKeys.has(department.key) ||
      selectedKeys.has(department.slug) ||
      selectedKeys.has(department.name)
  );

  if (!selectedSeeds.length) {
    throw new ApiError(400, "No valid default departments selected");
  }

  const existingDepartments = await Department.find({
    companyId,
    $or: [
      { normalizedName: { $in: selectedSeeds.map((department) => department.normalizedName) } },
      { slug: { $in: selectedSeeds.map((department) => department.slug) } },
    ],
    deletedAt: null,
  });

  const existingByName = new Map(
    existingDepartments.flatMap((department) => [
      [department.normalizedName, department],
      [department.slug, department],
    ])
  );

  const departmentsToCreate = selectedSeeds
    .filter((department) => !existingByName.has(department.normalizedName) && !existingByName.has(department.slug))
    .map((department) => ({
      companyId,
      name: department.name,
      normalizedName: department.normalizedName,
      slug: department.slug,
      code: department.code,
      description: department.description,
      allowedRoles: ["employee"],
      status: "active",
      source: "default",
      isDefaultSeed: true,
      isSystemDefault: true,
      isActive: true,
      isArchived: false,
      createdBy: user._id,
      updatedBy: user._id,
    }));

  let createdDepartments = [];

  try {
    createdDepartments = departmentsToCreate.length
      ? await Department.insertMany(departmentsToCreate, { ordered: false })
      : [];
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }
  }

  const selectedExistingDepartments = selectedSeeds
    .map((department) => existingByName.get(department.normalizedName) || existingByName.get(department.slug))
    .filter(Boolean);

  const headDesignationResults = await Promise.allSettled(
    [...createdDepartments, ...selectedExistingDepartments].map((department) =>
      ensureHeadDesignationForDepartment({
        companyId,
        department,
        userId: user._id,
      })
    )
  );

  const headDesignations = headDesignationResults
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => mapHeadDesignation(result.value));

  return {
    created: createdDepartments.map(mapDepartment),
    headDesignations,
    skippedExisting: selectedSeeds
      .filter((department) => existingByName.has(department.normalizedName) || existingByName.has(department.slug))
      .map((department) => mapDefaultDepartmentSeed(
        department,
        existingByName.get(department.normalizedName) || existingByName.get(department.slug)
      )),
  };
};

const archiveDepartment = async ({ departmentId, isArchived, user }) => {
  const companyId = assertCanManageDepartments(user);

  const department = await Department.findOne({
    _id: departmentId,
    companyId,
    deletedAt: null,
  });

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  department.isArchived = isArchived;
  department.isActive = !isArchived;
  department.status = isArchived ? "inactive" : "active";
  department.archivedAt = isArchived ? new Date() : null;
  department.updatedBy = user._id;
  await department.save();

  return mapDepartment(department);
};

module.exports = {
  READ_ROLES,
  MANAGE_ROLES,
  mapDepartment,
  listDepartments,
  getAvailableDefaultDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  updateDepartmentStatus,
  bulkCreateDefaultDepartments,
  ensureHeadDesignationForDepartment,
  archiveDepartment,
};
