const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const ApiError = require("../utils/ApiError");
const { normalizeName, normalizeCode, slugify } = require("../utils/normalize");
const {
  ORG_PERMISSIONS,
  getSystemRole,
  hasExplicitPermission,
} = require("./permission.service");
const { validateReportingManagerAssignment } = require("./reporting.service");

const HR_DEPARTMENT_NAMES = ["human resource", "human resources"];
const HR_DEPARTMENT_SLUGS = ["human-resource", "human-resources"];
const HR_HEAD_TITLES = ["Head of HR", "HR Head"];
const HR_HEAD_NORMALIZED_TITLES = HR_HEAD_TITLES.map(normalizeName);

const mapDepartment = (department) =>
  department
    ? {
        _id: department._id,
        id: department._id,
        name: department.name,
        code: department.code || "",
        slug: department.slug || "",
        status: department.status,
      }
    : null;

const mapDesignation = (designation) =>
  designation
    ? {
        _id: designation._id,
        id: designation._id,
        title: designation.title || designation.name,
        name: designation.name,
        code: designation.code || "",
        hierarchyLevel: designation.hierarchyLevel,
        status: designation.status,
      }
    : null;

const mapHrHead = (user) =>
  user
    ? {
        _id: user._id,
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        systemRole: user.systemRole || user.role,
        permissionScope: user.permissionScope,
        department: user.department || "",
        departmentId: mapDepartment(user.departmentId),
        designation: user.designation || "",
        designationId: mapDesignation(user.designationId),
        employeeId: user.employeeId || "",
        status: user.status,
        createdAt: user.createdAt,
      }
    : null;

const assertCompanyContext = (user) => {
  if (!user?.companyId) {
    throw new ApiError(400, "Company is missing for this user.");
  }

  return user.companyId;
};

const canManageInitialHrSetup = (user) => {
  const role = getSystemRole(user);
  return (
    role === "company_admin" ||
    (role === "sub_admin" &&
      hasExplicitPermission(user, ORG_PERMISSIONS.MANAGE_EMPLOYEE_RECORDS) &&
      hasExplicitPermission(user, ORG_PERMISSIONS.ASSIGN_REPORTING_MANAGER))
  );
};

const assertCanManageInitialHrSetup = (user) => {
  if (!canManageInitialHrSetup(user)) {
    throw new ApiError(403, "Only company admin can manage initial HR setup.");
  }
};

const findHumanResourceDepartment = (companyId) =>
  Department.findOne({
    companyId,
    deletedAt: null,
    status: "active",
    isArchived: { $ne: true },
    $or: [
      { normalizedName: { $in: HR_DEPARTMENT_NAMES } },
      { slug: { $in: HR_DEPARTMENT_SLUGS } },
      { name: /^human resources?$/i },
    ],
  });

const findHrHeadDesignation = async ({ companyId, departmentId }) =>
  Designation.findOne({
    companyId,
    departmentId,
    deletedAt: null,
    status: "active",
    isArchived: { $ne: true },
    $or: [
      { normalizedTitle: { $in: HR_HEAD_NORMALIZED_TITLES } },
      { normalizedName: { $in: HR_HEAD_NORMALIZED_TITLES } },
      { title: { $in: HR_HEAD_TITLES } },
      { name: { $in: HR_HEAD_TITLES } },
    ],
  });

const ensureHrHeadDesignation = async ({ companyId, department, user }) => {
  const existing = await findHrHeadDesignation({
    companyId,
    departmentId: department._id,
  });

  if (existing) return existing;

  const title = "Head of HR";
  return Designation.create({
    companyId,
    departmentId: department._id,
    name: title,
    title,
    normalizedName: normalizeName(title),
    normalizedTitle: normalizeName(title),
    slug: slugify(title),
    code: normalizeCode(title).slice(0, 24),
    description: "Primary HR leadership designation.",
    hierarchyLevel: 6,
    allowedParentLevels: [],
    mappedRole: "",
    allowedRoles: [],
    canManagePeople: false,
    isLeadership: false,
    status: "active",
    source: "default",
    isDefaultSeed: true,
    isActive: true,
    isArchived: false,
    createdBy: user._id,
    updatedBy: user._id,
  });
};

const findActiveHrHead = async ({ companyId, department, designation = null }) => {
  if (!department) return null;

  const designationIds = [];
  if (designation?._id) designationIds.push(designation._id);

  const titleQuery = {
    $or: [
      { designation: { $in: HR_HEAD_TITLES } },
      { designation: /^head of hr$/i },
      { designation: /^hr head$/i },
    ],
  };

  const structuredQuery = designationIds.length
    ? { designationId: { $in: designationIds } }
    : titleQuery;

  return User.findOne({
    companyId,
    role: { $in: ["hr_head", "hr_manager"] },
    status: "active",
    deletedAt: null,
    $and: [
      {
        $or: [
          { departmentId: department._id },
          { department: /^human resources?$/i },
        ],
      },
      {
        $or: [
          structuredQuery,
          titleQuery,
        ],
      },
    ],
  })
    .select("-passwordHash")
    .populate("departmentId", "name code slug status")
    .populate("designationId", "name title code hierarchyLevel status");
};

const findDefaultReportingManager = async ({ companyId, actorUser }) => {
  if (getSystemRole(actorUser) === "company_admin") {
    return actorUser._id;
  }

  const companyAdmin = await User.findOne({
    companyId,
    role: "company_admin",
    status: "active",
    deletedAt: null,
  }).select("_id");

  if (!companyAdmin) {
    throw new ApiError(400, "Active Company Admin is required as HR Head reporting manager.");
  }

  return companyAdmin._id;
};

const getHrSetupStatus = async ({ user }) => {
  assertCanManageInitialHrSetup(user);
  const companyId = assertCompanyContext(user);
  const department = await findHumanResourceDepartment(companyId);
  const designation = department
    ? await findHrHeadDesignation({ companyId, departmentId: department._id })
    : null;
  const hrHead = department
    ? await findActiveHrHead({ companyId, department, designation })
    : null;

  return {
    hasHumanResourceDepartment: Boolean(department),
    humanResourceDepartment: mapDepartment(department),
    hrHeadDesignation: mapDesignation(designation),
    hasHrHead: Boolean(hrHead),
    hrHead: mapHrHead(hrHead),
    canCreateHrHead: Boolean(department && !hrHead),
    nextStep: !department
      ? "CREATE_HR_DEPARTMENT"
      : hrHead
        ? "HR_HEAD_READY"
        : "CREATE_HR_HEAD",
  };
};

const createHrHead = async ({ payload, user }) => {
  assertCanManageInitialHrSetup(user);
  const companyId = assertCompanyContext(user);
  const { fullName, email, password, phone = "", employeeId = "" } = payload || {};

  if (!fullName || !email || !password) {
    throw new ApiError(400, "Full name, work email and password are required.");
  }

  const department = await findHumanResourceDepartment(companyId);
  if (!department) {
    throw new ApiError(400, "Create an active Human Resource department before creating HR Head.");
  }

  const designation = await ensureHrHeadDesignation({
    companyId,
    department,
    user,
  });

  const existingHrHead = await findActiveHrHead({ companyId, department, designation });
  if (existingHrHead) {
    throw new ApiError(409, "Active HR Head already exists for this company.");
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existingEmail = await User.findOne({
    email: normalizedEmail,
    deletedAt: null,
  });

  if (existingEmail) {
    throw new ApiError(409, "User already exists with this email.");
  }

  const defaultReportingManagerId = await findDefaultReportingManager({
    companyId,
    actorUser: user,
  });

  const assignment = await validateReportingManagerAssignment({
    companyId,
    employeeDesignationId: designation._id,
    departmentId: department._id,
    reportingManagerId: defaultReportingManagerId,
    actorUser: user,
    employeeRole: "hr_head",
  });
  const reportingManagerId = assignment.reportingManagerId;
  const passwordHash = await bcrypt.hash(password, 10);

  const hrHead = await User.create({
    companyId,
    fullName: String(fullName).trim(),
    email: normalizedEmail,
    phone: String(phone || "").trim(),
    passwordHash,
    role: "hr_head",
    systemRole: "hr_head",
    permissionScope: "company",
    customPermissions: [
      ORG_PERMISSIONS.MANAGE_EMPLOYEE_RECORDS,
      ORG_PERMISSIONS.VIEW_ORG_TREE,
    ],
    department: department.name,
    departmentId: department._id,
    designation: designation.title || designation.name,
    designationId: designation._id,
    employeeId: String(employeeId || "").trim(),
    managerId: reportingManagerId,
    reportingManagerId,
    status: "active",
    isEmailVerified: true,
    setupCompleted: true,
    setupCompletedAt: new Date(),
    createdBy: user._id,
    updatedBy: user._id,
  });

  await hrHead.populate("departmentId", "name code slug status");
  await hrHead.populate("designationId", "name title code hierarchyLevel status");

  return {
    setup: {
      hasHumanResourceDepartment: true,
      humanResourceDepartment: mapDepartment(department),
      hrHeadDesignation: mapDesignation(designation),
      hasHrHead: true,
      hrHead: mapHrHead(hrHead),
      canCreateHrHead: false,
      nextStep: "HR_HEAD_READY",
    },
    hrHead: mapHrHead(hrHead),
  };
};

module.exports = {
  getHrSetupStatus,
  createHrHead,
};
