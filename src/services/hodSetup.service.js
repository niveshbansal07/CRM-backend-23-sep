const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Company = require("../models/Company");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const EmployeeRequest = require("../models/EmployeeRequest");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { normalizeName } = require("../utils/normalize");
const { getAccessRole } = require("../utils/roleAccess");
const {
  resolveEmployeeRoleV2,
  validateRoleAssignment,
} = require("../utils/employeeRole");
const { getCompanyIdOrThrow } = require("./tenant.service");
const { validateReportingManagerAssignment } = require("./reporting.service");
const {
  getDefaultPermissionsForRole,
  sanitizePermissions,
} = require("./permission.service");
const { writeAuditLog } = require("./auditLog.service");
const { invalidateOrgTreeCache } = require("./orgTree.service");

const IN_PROGRESS_HEAD_REQUEST_STATUSES = ["pending", "approved", "setup_pending"];
const HEAD_TITLE_PATTERN = /\b(head|department head|hod|director|chief|vp)\b/i;
const HR_DEPARTMENT_NAMES = new Set(["hr", "human resource", "human resources"]);

const HOD_SETUP_STATUSES = {
  READY: "ready",
  SETUP_REQUIRED: "setup_required",
  SETUP_IN_PROGRESS: "setup_in_progress",
  MISSING_HEAD_DESIGNATION: "missing_head_designation",
  INACTIVE: "inactive",
};

const DEFAULT_DEPENDENCIES = {
  Company,
  Department,
  Designation,
  EmployeeRequest,
  User,
  startSession: () => mongoose.startSession(),
  hashPassword: (password) => bcrypt.hash(password, 10),
  validateReportingManagerAssignment,
  getDefaultPermissionsForRole,
  sanitizePermissions,
  writeAuditLog,
  invalidateOrgTreeCache,
};

const withDependencies = (overrides = {}) => ({
  ...DEFAULT_DEPENDENCIES,
  ...overrides,
});

const toId = (value) => String(value?._id || value?.id || value || "");

const applySession = (query, session) => {
  if (session && query && typeof query.session === "function") {
    return query.session(session);
  }
  return query;
};

const assertCompanyAdmin = (user) => {
  if (!user || getAccessRole(user) !== "company_admin") {
    throw new ApiError(403, "Only Company Admin can manage initial Department HOD setup.");
  }
  return getCompanyIdOrThrow(user);
};

const isHumanResourceDepartment = (department) => {
  const name = normalizeName(
    department?.normalizedName || department?.name || department?.slug || ""
  );
  const slugName = normalizeName(department?.slug || "");
  return HR_DEPARTMENT_NAMES.has(name) || HR_DEPARTMENT_NAMES.has(slugName);
};

const isExplicitHeadDesignation = (designation) => {
  const title = designation?.title || designation?.name || "";
  return Boolean(
    designation?.isDepartmentHead === true ||
      designation?.isHead === true ||
      designation?.mappedRole === "department_head" ||
      HEAD_TITLE_PATTERN.test(title)
  );
};

const findQualifyingHeadDesignations = async ({
  companyId,
  departmentId,
  session = null,
  dependencies = {},
}) => {
  const { Designation: DesignationModel } = withDependencies(dependencies);
  const query = DesignationModel.find({
    companyId,
    departmentId,
    status: "active",
    isActive: { $ne: false },
    isArchived: { $ne: true },
    deletedAt: null,
  }).sort({ hierarchyLevel: -1, createdAt: 1 });
  const designations = await applySession(query, session);
  const explicitHeads = designations.filter(isExplicitHeadDesignation);

  // This matches the existing HRMS compatibility fallback: when legacy data has
  // no explicit marker, the highest active designation is treated as the head.
  return explicitHeads.length ? explicitHeads : designations.slice(0, 1);
};

const selectHeadDesignation = (department, designations = []) => {
  if (!designations.length) return null;
  const configuredId = toId(department?.headDesignationId);
  return (
    designations.find((designation) => configuredId && toId(designation) === configuredId) ||
    designations.find((designation) => designation.isHead === true) ||
    designations.find((designation) => designation.isDepartmentHead === true) ||
    designations[0]
  );
};

const findActiveHod = async ({
  companyId,
  departmentId,
  designationIds,
  session = null,
  dependencies = {},
}) => {
  const { User: UserModel } = withDependencies(dependencies);
  const query = UserModel.findOne({
    companyId,
    departmentId,
    designationId: { $in: designationIds },
    status: "active",
    deletedAt: null,
  });
  return applySession(query, session);
};

const findInProgressHeadRequest = async ({
  companyId,
  departmentId,
  designationIds,
  session = null,
  dependencies = {},
}) => {
  const { EmployeeRequest: EmployeeRequestModel } = withDependencies(dependencies);
  const query = EmployeeRequestModel.findOne({
    companyId,
    requestedDepartmentId: departmentId,
    requestedDesignationId: { $in: designationIds },
    status: { $in: IN_PROGRESS_HEAD_REQUEST_STATUSES },
    deletedAt: null,
  });
  return applySession(query, session);
};

const mapDepartment = (department) => ({
  id: department._id,
  _id: department._id,
  name: department.name,
  code: department.code || "",
  slug: department.slug || "",
  status: department.status,
  isActive: department.isActive !== false && department.status === "active",
  isArchived: department.isArchived === true,
});

const mapDesignation = (designation) =>
  designation
    ? {
        id: designation._id,
        _id: designation._id,
        departmentId: designation.departmentId,
        name: designation.name,
        title: designation.title || designation.name,
        code: designation.code || "",
        hierarchyLevel: designation.hierarchyLevel,
        isDepartmentHead: designation.isDepartmentHead === true,
        isHead: designation.isHead === true,
        status: designation.status,
      }
    : null;

const mapHod = (user) =>
  user
    ? {
        id: user._id,
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone || "",
        employeeId: user.employeeId || "",
        role: user.role,
        systemRole: user.systemRole || user.role,
        departmentId: user.departmentId,
        designationId: user.designationId,
        reportingManagerId: user.reportingManagerId || user.managerId || null,
        joiningDate: user.joiningDate || null,
        status: user.status,
        setupCompleted: user.setupCompleted === true,
        createdAt: user.createdAt,
      }
    : null;

const resolveDepartmentStatus = ({ department, designation, hod, inProgressRequest }) => {
  if (
    department.status !== "active" ||
    department.isActive === false ||
    department.isArchived === true
  ) {
    return HOD_SETUP_STATUSES.INACTIVE;
  }
  if (!designation) return HOD_SETUP_STATUSES.MISSING_HEAD_DESIGNATION;
  if (hod) return HOD_SETUP_STATUSES.READY;
  if (inProgressRequest) return HOD_SETUP_STATUSES.SETUP_IN_PROGRESS;
  return HOD_SETUP_STATUSES.SETUP_REQUIRED;
};

const buildDepartmentStatus = async ({ department, companyId, dependencies = {} }) => {
  const headDesignations = await findQualifyingHeadDesignations({
    companyId,
    departmentId: department._id,
    dependencies,
  });
  const designation = selectHeadDesignation(department, headDesignations);
  const designationIds = headDesignations.map((item) => item._id);
  const [hod, inProgressRequest] = designationIds.length
    ? await Promise.all([
        findActiveHod({
          companyId,
          departmentId: department._id,
          designationIds,
          dependencies,
        }),
        findInProgressHeadRequest({
          companyId,
          departmentId: department._id,
          designationIds,
          dependencies,
        }),
      ])
    : [null, null];
  const status = resolveDepartmentStatus({ department, designation, hod, inProgressRequest });
  const setupFlow = isHumanResourceDepartment(department) ? "existing_hr_setup" : "generic";

  return {
    department: mapDepartment(department),
    headDesignation: mapDesignation(designation),
    hod: mapHod(hod),
    status,
    canSetup: setupFlow === "generic" && status === HOD_SETUP_STATUSES.SETUP_REQUIRED,
    setupFlow,
  };
};

const listDepartmentHodStatuses = async ({ user, dependencies = {} }) => {
  const companyId = assertCompanyAdmin(user);
  const { Department: DepartmentModel } = withDependencies(dependencies);
  const departments = await DepartmentModel.find({ companyId, deletedAt: null }).sort({ name: 1 });
  const rows = await Promise.all(
    departments.map((department) => buildDepartmentStatus({ department, companyId, dependencies }))
  );

  return {
    totalDepartments: rows.length,
    readyCount: rows.filter((row) => row.status === HOD_SETUP_STATUSES.READY).length,
    setupRequiredCount: rows.filter((row) => row.status === HOD_SETUP_STATUSES.SETUP_REQUIRED).length,
    setupInProgressCount: rows.filter((row) => row.status === HOD_SETUP_STATUSES.SETUP_IN_PROGRESS).length,
    unavailableCount: rows.filter((row) =>
      [HOD_SETUP_STATUSES.MISSING_HEAD_DESIGNATION, HOD_SETUP_STATUSES.INACTIVE].includes(row.status)
    ).length,
    departments: rows,
  };
};

const resolveHodAccess = ({ department, designation, companyId, dependencies = {} }) => {
  const role = resolveEmployeeRoleV2({ department, designation, companyId });
  const validation = validateRoleAssignment(role, designation, department);
  if (!validation.valid) {
    throw new ApiError(400, validation.reason || "HOD access role could not be resolved safely.");
  }
  if (!new Set(["manager", "sales_head"]).has(role)) {
    throw new ApiError(400, "HOD access role could not be resolved safely.");
  }

  const deps = withDependencies(dependencies);
  const defaultPermissions = deps.getDefaultPermissionsForRole(role);
  return {
    role,
    systemRole: role,
    permissionScope: "self",
    customPermissions: deps.sanitizePermissions(defaultPermissions),
  };
};

const getOwnerCompanyAdmin = async ({ companyId, session, dependencies = {} }) => {
  const deps = withDependencies(dependencies);
  const company = await applySession(
    deps.Company.findOne({
      _id: companyId,
      status: "active",
      deletedAt: null,
      ownerUserId: { $ne: null },
    }),
    session
  );
  if (!company?.ownerUserId) {
    throw new ApiError(400, "Active owner Company Admin is required as HOD reporting manager.");
  }

  const companyAdmin = await applySession(
    deps.User.findOne({
      _id: company.ownerUserId,
      companyId,
      role: "company_admin",
      status: "active",
      deletedAt: null,
    }),
    session
  );
  if (!companyAdmin) {
    throw new ApiError(400, "Active owner Company Admin is required as HOD reporting manager.");
  }
  return companyAdmin;
};

const isDuplicateKeyError = (error) => error?.code === 11000;
const isTransactionConflict = (error) =>
  [112, 244, 251].includes(error?.code) ||
  error?.errorLabels?.includes?.("TransientTransactionError") ||
  /write conflict|transaction.*conflict/i.test(String(error?.message || ""));

const mapCreateError = (error) => {
  if (error instanceof ApiError) return error;
  if (isDuplicateKeyError(error)) {
    if (error?.keyPattern?.employeeId) {
      return new ApiError(409, "Employee ID already exists in this company.");
    }
    return new ApiError(409, "A user already exists with this work email.");
  }
  if (isTransactionConflict(error)) {
    return new ApiError(409, "HOD setup changed during this request. Refresh the status and try again.");
  }
  return error;
};

const createDepartmentHod = async ({
  departmentId,
  payload,
  user,
  req = null,
  dependencies = {},
}) => {
  const companyId = assertCompanyAdmin(user);
  const deps = withDependencies(dependencies);
  const passwordHash = await deps.hashPassword(payload.password);
  const session = await deps.startSession();
  let result = null;
  let committed = false;

  session.startTransaction();
  try {
    // Updating updatedAt provides a real document write lock. Concurrent setup
    // transactions for the same Department cannot both pass this point.
    const department = await deps.Department.findOneAndUpdate(
      {
        _id: departmentId,
        companyId,
        status: "active",
        isActive: { $ne: false },
        isArchived: { $ne: true },
        deletedAt: null,
      },
      { $set: { updatedAt: new Date() } },
      { new: true, session }
    );

    if (!department) {
      const existingDepartment = await applySession(
        deps.Department.findOne({ _id: departmentId, companyId, deletedAt: null }),
        session
      );
      if (existingDepartment) {
        throw new ApiError(409, "Department is inactive and cannot be configured.");
      }
      throw new ApiError(404, "Department not found.");
    }

    if (isHumanResourceDepartment(department)) {
      throw new ApiError(
        409,
        "Human Resources HOD must be configured through the existing HR setup flow."
      );
    }

    const headDesignations = await findQualifyingHeadDesignations({
      companyId,
      departmentId: department._id,
      session,
      dependencies,
    });
    const headDesignation = selectHeadDesignation(department, headDesignations);
    if (!headDesignation) {
      throw new ApiError(409, "Department HOD designation is missing. Recreate or repair the Department setup first.");
    }
    const headDesignationIds = headDesignations.map((item) => item._id);

    const existingHod = await findActiveHod({
      companyId,
      departmentId: department._id,
      designationIds: headDesignationIds,
      session,
      dependencies,
    });
    if (existingHod) {
      throw new ApiError(409, "HOD is already configured for this Department.");
    }

    const inProgressRequest = await findInProgressHeadRequest({
      companyId,
      departmentId: department._id,
      designationIds: headDesignationIds,
      session,
      dependencies,
    });
    if (inProgressRequest) {
      throw new ApiError(409, "HOD setup is already in progress through an existing employee request.");
    }

    const existingEmail = await applySession(
      deps.User.findOne({ email: payload.email, deletedAt: null }),
      session
    );
    if (existingEmail) throw new ApiError(409, "A user already exists with this work email.");

    const existingEmployeeId = await applySession(
      deps.User.findOne({ companyId, employeeId: payload.employeeId, deletedAt: null }),
      session
    );
    if (existingEmployeeId) {
      throw new ApiError(409, "Employee ID already exists in this company.");
    }

    const companyAdmin = await getOwnerCompanyAdmin({ companyId, session, dependencies });
    const access = resolveHodAccess({
      department,
      designation: headDesignation,
      companyId,
      dependencies,
    });
    const assignment = await deps.validateReportingManagerAssignment({
      companyId,
      employeeDesignationId: headDesignation._id,
      departmentId: department._id,
      reportingManagerId: companyAdmin._id,
      actorUser: user,
      employeeRole: access.role,
    });
    if (!assignment?.reportingManagerId) {
      throw new ApiError(400, "Active owner Company Admin is required as HOD reporting manager.");
    }

    const [hod] = await deps.User.create(
      [
        {
          companyId,
          fullName: payload.fullName,
          email: payload.email,
          phone: payload.phone,
          passwordHash,
          role: access.role,
          systemRole: access.systemRole,
          permissionScope: access.permissionScope,
          customPermissions: access.customPermissions,
          department: department.name,
          departmentId: department._id,
          designation: headDesignation.title || headDesignation.name,
          designationId: headDesignation._id,
          employeeId: payload.employeeId,
          managerId: assignment.reportingManagerId,
          reportingManagerId: assignment.reportingManagerId,
          joiningDate: payload.joiningDate,
          setupCompleted: true,
          setupCompletedAt: new Date(),
          status: "active",
          isEmailVerified: true,
          createdBy: user._id,
          updatedBy: user._id,
        },
      ],
      { session }
    );

    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: "department_hod.setup",
      entityType: "User",
      entityId: hod._id,
      metadata: {
        departmentId: toId(department._id),
        designationId: toId(headDesignation._id),
        hodUserId: toId(hod._id),
      },
      req,
      session,
    });

    result = {
      department: mapDepartment(department),
      headDesignation: mapDesignation(headDesignation),
      hod: mapHod(hod),
      status: HOD_SETUP_STATUSES.READY,
      canSetup: false,
      setupFlow: "generic",
    };

    await session.commitTransaction();
    committed = true;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw mapCreateError(error);
  } finally {
    await session.endSession();
  }

  if (committed) deps.invalidateOrgTreeCache(companyId);
  return result;
};

module.exports = {
  HOD_SETUP_STATUSES,
  IN_PROGRESS_HEAD_REQUEST_STATUSES,
  assertCompanyAdmin,
  isHumanResourceDepartment,
  isExplicitHeadDesignation,
  findQualifyingHeadDesignations,
  selectHeadDesignation,
  resolveDepartmentStatus,
  resolveHodAccess,
  listDepartmentHodStatuses,
  createDepartmentHod,
};
