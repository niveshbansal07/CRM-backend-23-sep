const mongoose = require("mongoose");
const User = require("../models/User");
const Designation = require("../models/Designation");
const ApiError = require("../utils/ApiError");
const {
  ORG_PERMISSIONS,
  getSystemRole,
  hasExplicitPermission,
} = require("./permission.service");

const HEAD_TITLE_PATTERN = /\b(head|business head|department head|director|vp|chief|cto|ceo|cfo|coo)\b/i;

const toId = (value) => {
  if (!value) return null;
  if (value._id) return String(value._id);
  return String(value);
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const withSession = (query, session) => session && query?.session ? query.session(session) : query;

const canOverrideReportingAssignment = (actorUser) => {
  const role = getSystemRole(actorUser);
  return (
    role === "super_admin" ||
    role === "company_admin" ||
    (role === "sub_admin" &&
      hasExplicitPermission(actorUser, ORG_PERMISSIONS.ASSIGN_REPORTING_MANAGER))
  );
};

const mapManager = ({ user, designation, employeeDesignation }) => {
  const managerLevel = Number(designation?.hierarchyLevel || 0);
  const employeeLevel = Number(employeeDesignation?.hierarchyLevel || 0);

  return {
    _id: user._id,
    id: user._id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    systemRole: user.systemRole || user.role,
    department: user.departmentId?.name || user.department || "",
    departmentId: toId(user.departmentId),
    designation: designation?.title || designation?.name || user.designation || "",
    designationId: toId(designation),
    hierarchyLevel: managerLevel || null,
    employeeId: user.employeeId,
    status: user.status,
    isSkippedLevel: Boolean(employeeLevel && managerLevel > employeeLevel + 1),
  };
};

const getActiveDesignation = async ({ companyId, designationId, departmentId, label, session = null }) => {
  if (!designationId) return null;

  if (!isValidObjectId(designationId)) {
    throw new ApiError(400, `${label || "Designation"} must be a valid ObjectId`);
  }

  const query = {
    _id: designationId,
    companyId,
    status: "active",
    isArchived: { $ne: true },
    deletedAt: null,
  };

  if (departmentId) {
    query.departmentId = departmentId;
  }

  const designation = await withSession(Designation.findOne(query), session);

  if (!designation) {
    throw new ApiError(404, `${label || "Active designation"} not found`);
  }

  return designation;
};

const isTopLevelUser = ({ role, designation }) => {
  const systemRole = role || "";
  if (["super_admin", "company_admin"].includes(systemRole)) return true;
  if (!designation) return false;

  const title = designation.title || designation.name || "";
  return (
    Number(designation.hierarchyLevel || 0) >= 6 ||
    HEAD_TITLE_PATTERN.test(title)
  );
};

const detectReportingCycle = async ({ employeeId, reportingManagerId, companyId, session = null }) => {
  if (!employeeId || !reportingManagerId) return false;

  const employeeKey = String(employeeId);
  let cursorId = String(reportingManagerId);
  const visited = new Set();

  while (cursorId) {
    if (cursorId === employeeKey) return true;
    if (visited.has(cursorId)) return true;

    visited.add(cursorId);

    const manager = await withSession(User.findOne({
      _id: cursorId,
      companyId,
      deletedAt: null,
    }).select("_id reportingManagerId managerId"), session);

    if (!manager) return false;

    cursorId = toId(manager.reportingManagerId || manager.managerId);
  }

  return false;
};

const getAllowedManagersForEmployee = async ({
  companyId,
  departmentId = null,
  designationId,
  excludeUserId = null,
  actorUser = null,
  includeCrossDepartment = false,
}) => {
  if (!companyId) {
    throw new ApiError(400, "Company is required to load reporting managers");
  }

  if (departmentId && !isValidObjectId(departmentId)) {
    throw new ApiError(400, "Department id must be a valid ObjectId");
  }

  if (!designationId) {
    throw new ApiError(400, "Designation is required to load reporting managers");
  }

  const employeeDesignation = await getActiveDesignation({
    companyId,
    designationId,
    departmentId,
    label: "Employee designation",
  });
  const downlineIds = excludeUserId
    ? new Set(
        (await getDownlineEmployeeIds({
          companyId,
          employeeId: excludeUserId,
        })).map((id) => String(id))
      )
    : new Set();

  const allowCrossDepartment =
    includeCrossDepartment === true && canOverrideReportingAssignment(actorUser);

  const query = {
    companyId,
    status: "active",
    deletedAt: null,
    designationId: { $ne: null },
  };

  if (excludeUserId) {
    if (!isValidObjectId(excludeUserId)) {
      throw new ApiError(400, "Excluded user id must be a valid ObjectId");
    }
    query._id = { $ne: excludeUserId };
  }

  if (departmentId && !allowCrossDepartment) {
    query.departmentId = departmentId;
  }

  const candidates = await User.find(query)
    .select("fullName email role systemRole department departmentId designation designationId employeeId status")
    .populate("departmentId", "name code status")
    .populate({
      path: "designationId",
      match: {
        companyId,
        status: "active",
        isArchived: { $ne: true },
        deletedAt: null,
      },
      select: "name title hierarchyLevel departmentId status",
    })
    .sort({ fullName: 1 });

  return candidates
    .filter((candidate) => {
      const managerDesignation = candidate.designationId;
      if (!managerDesignation) return false;
      if (downlineIds.has(String(candidate._id))) return false;

      if (
        departmentId &&
        !allowCrossDepartment &&
        toId(managerDesignation.departmentId) !== String(departmentId)
      ) {
        return false;
      }

      return (
        Number(managerDesignation.hierarchyLevel || 0) >
        Number(employeeDesignation.hierarchyLevel || 0)
      );
    })
    .sort((first, second) => {
      const firstLevel = Number(first.designationId?.hierarchyLevel || 0);
      const secondLevel = Number(second.designationId?.hierarchyLevel || 0);
      if (firstLevel !== secondLevel) return secondLevel - firstLevel;
      return String(first.fullName || "").localeCompare(String(second.fullName || ""));
    })
    .map((candidate) =>
      mapManager({
        user: candidate,
        designation: candidate.designationId,
        employeeDesignation,
      })
    );
};

const validateReportingManagerAssignment = async ({
  companyId,
  employeeId = null,
  employeeDesignationId = null,
  departmentId = null,
  reportingManagerId = null,
  actorUser = null,
  employeeRole = "employee",
  allowEmptyForLegacy = true,
  session = null,
}) => {
  if (!companyId) {
    throw new ApiError(400, "Company is required to assign reporting manager");
  }

  const employeeDesignation = await getActiveDesignation({
    companyId,
    designationId: employeeDesignationId,
    departmentId,
    label: "Employee designation",
    session,
  });

  const canOverride = canOverrideReportingAssignment(actorUser);
  const normalizedManagerId = reportingManagerId ? String(reportingManagerId) : null;

  if (!normalizedManagerId) {
    if (!employeeDesignation && allowEmptyForLegacy) {
      return {
        reportingManagerId: null,
        manager: null,
        warnings: [],
        isTopLevel: false,
      };
    }

    if (!isTopLevelUser({ role: employeeRole, designation: employeeDesignation }) && !canOverride) {
      throw new ApiError(400, "Reporting manager is required for this designation");
    }

    return {
      reportingManagerId: null,
      manager: null,
      warnings: [],
      isTopLevel: true,
    };
  }

  if (!isValidObjectId(normalizedManagerId)) {
    throw new ApiError(400, "Reporting manager must be a valid ObjectId");
  }

  if (employeeId && String(employeeId) === normalizedManagerId) {
    throw new ApiError(400, "Employee cannot be their own reporting manager");
  }

  const manager = await withSession(User.findOne({
    _id: normalizedManagerId,
    companyId,
    status: "active",
    deletedAt: null,
  })
    .select("fullName email role systemRole department departmentId designation designationId employeeId status reportingManagerId managerId")
    .populate("departmentId", "name code status")
    .populate({
      path: "designationId",
      match: {
        companyId,
        status: "active",
        isArchived: { $ne: true },
        deletedAt: null,
      },
      select: "name title hierarchyLevel departmentId status",
    }), session);

  if (!manager) {
    throw new ApiError(404, "Active reporting manager not found");
  }

  const hasCycle = await detectReportingCycle({
    employeeId,
    reportingManagerId: normalizedManagerId,
    companyId,
    session,
  });

  if (hasCycle) {
    throw new ApiError(400, "Circular reporting hierarchy is not allowed");
  }

  if (!employeeDesignation) {
    return {
      reportingManagerId: manager._id,
      manager,
      warnings: [],
      isSkippedLevel: false,
      overrideUsed: false,
    };
  }

  const managerDesignation = manager.designationId;
  const warnings = [];

  if (!managerDesignation) {
    if (!canOverride) {
      throw new ApiError(400, "Reporting manager must have an active designation");
    }
    warnings.push("Manager has no active structured designation; override applied.");
  }

  const employeeDepartmentId = departmentId || employeeDesignation.departmentId;
  const managerDepartmentId =
    managerDesignation?.departmentId || manager.departmentId?._id || manager.departmentId;
  const isCrossDepartment =
    employeeDepartmentId &&
    managerDepartmentId &&
    String(employeeDepartmentId) !== String(managerDepartmentId);

  if (isCrossDepartment && !canOverride) {
    throw new ApiError(400, "Cross-department reporting manager assignment requires override permission");
  }

  const employeeLevel = Number(employeeDesignation.hierarchyLevel || 0);
  const managerLevel = Number(managerDesignation?.hierarchyLevel || 0);

  if (managerDesignation && managerLevel <= employeeLevel) {
    if (!canOverride) {
      throw new ApiError(400, "Reporting manager must have a higher hierarchy level");
    }
    warnings.push("Manager hierarchy level is not higher; override applied.");
  }

  return {
    reportingManagerId: manager._id,
    manager,
    employeeDesignation,
    managerDesignation,
    warnings,
    isSkippedLevel: Boolean(managerLevel && employeeLevel && managerLevel > employeeLevel + 1),
    overrideUsed: warnings.length > 0 || isCrossDepartment,
  };
};

const getDownlineEmployeeIds = async ({
  companyId,
  employeeId,
  includeInactive = false,
}) => {
  if (!companyId) {
    throw new ApiError(400, "Company is required to load downline employees");
  }

  if (!employeeId || !isValidObjectId(employeeId)) {
    throw new ApiError(400, "Employee id must be a valid ObjectId");
  }

  const results = [];
  let frontier = [String(employeeId)];
  const visited = new Set(frontier);

  while (frontier.length) {
    const query = {
      companyId,
      deletedAt: null,
      $or: [
        { reportingManagerId: { $in: frontier } },
        { managerId: { $in: frontier } },
      ],
    };

    if (!includeInactive) {
      query.status = "active";
    }

    const directReports = await User.find(query).select("_id");
    const next = [];

    directReports.forEach((employee) => {
      const id = String(employee._id);
      if (!visited.has(id)) {
        visited.add(id);
        results.push(employee._id);
        next.push(id);
      }
    });

    frontier = next;
  }

  return results;
};

module.exports = {
  canOverrideReportingAssignment,
  validateReportingManagerAssignment,
  detectReportingCycle,
  getAllowedManagersForEmployee,
  getDownlineEmployeeIds,
};
