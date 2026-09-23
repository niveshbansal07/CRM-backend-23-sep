const mongoose = require("mongoose");
const User = require("../models/User");
const Designation = require("../models/Designation");
const Department = require("../models/Department");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const { getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");
const {
  SALES_HIERARCHY,
  identifySalesDesignation,
  isSalesDepartment,
} = require("../constants/salesHierarchy");
const {
  SALES_LEVEL_GEOGRAPHY_TYPE,
  SALES_ASSIGNMENT_MANAGE_ROLES,
  SALES_ASSIGNMENT_OWN_READ_ROLES,
  ASSIGNMENT_READINESS,
  REPORTING_COMPATIBILITY,
  isResponsibleManagementLevel,
} = require("../constants/salesGeographyAssignment");

const DEFAULT_DEPS = {
  User,
  Designation,
  Department,
  Geography: SalesGeography,
  Assignment: SalesEmployeeGeographyAssignment,
  writeAuditLog,
  startSession: () => mongoose.startSession(),
  now: () => new Date(),
};

const toId = (value) => String(value?._id || value || "");
const sameId = (first, second) => toId(first) === toId(second);
const withSession = (query, session) => session && query?.session ? query.session(session) : query;
const depsFor = (dependencies = {}) => ({ ...DEFAULT_DEPS, ...dependencies });
const isDuplicateKeyError = (error) => error?.code === 11000;

const assertCanManageAssignments = (user) => {
  const role = getAccessRole(user);
  if (!user || !SALES_ASSIGNMENT_MANAGE_ROLES.includes(role)) {
    throw new ApiError(403, "Only Head of Sales or platform administrators can manage Sales Geography assignments");
  }
  const company = getCompanyIdOrThrow(user);
  return company?._id || company;
};

const assertCanReadOwnAssignment = (user) => {
  const role = getAccessRole(user);
  if (!user || !SALES_ASSIGNMENT_OWN_READ_ROLES.includes(role)) {
    throw new ApiError(403, "Sales assignment access denied");
  }
  const company = getCompanyIdOrThrow(user);
  return company?._id || company;
};

const expectedRoleForLevel = (level) =>
  SALES_HIERARCHY.find((item) => item.level === Number(level))?.technicalRole || "";

const resolveSalesDesignationIdentity = ({ employee, designation, department }) => {
  if (!department || !isSalesDepartment(department)) {
    return {
      valid: false,
      status: REPORTING_COMPATIBILITY.CROSS_DEPARTMENT,
      message: "Employee must belong to the Sales Department",
    };
  }
  if (!designation) {
    return {
      valid: false,
      status: ASSIGNMENT_READINESS.AMBIGUOUS_DESIGNATION,
      message: "Employee has no resolvable Sales designation",
    };
  }
  if (designation.status === "inactive" || designation.isActive === false || designation.isArchived === true) {
    return {
      valid: false,
      status: REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
      message: "Employee Sales designation is inactive or archived",
    };
  }

  const identity = identifySalesDesignation(designation);
  if (!identity.definition || identity.ambiguous) {
    return {
      valid: false,
      status: ASSIGNMENT_READINESS.AMBIGUOUS_DESIGNATION,
      message: "Sales designation is ambiguous and must be resolved through Phase 1",
      matchedBy: identity.matchedBy,
    };
  }

  const hierarchyLevel = Number(designation.hierarchyLevel);
  if (!Number.isInteger(hierarchyLevel) || hierarchyLevel < 1 || hierarchyLevel > 6) {
    return {
      valid: false,
      status: ASSIGNMENT_READINESS.MISSING_LEVEL,
      message: "Sales designation has no valid hierarchy level",
    };
  }
  if (hierarchyLevel !== identity.definition.level) {
    return {
      valid: false,
      status: REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
      message: "Sales designation code and hierarchy level conflict",
    };
  }

  const employeeRole = getAccessRole(employee);
  if (employeeRole !== identity.definition.technicalRole) {
    return {
      valid: false,
      status: REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
      message: "Employee technical role conflicts with the structured Sales designation",
    };
  }

  return {
    valid: true,
    hierarchyLevel,
    technicalRole: identity.definition.technicalRole,
    expectedGeographyType: SALES_LEVEL_GEOGRAPHY_TYPE[hierarchyLevel] || null,
    matchedBy: identity.matchedBy,
    designation: {
      id: designation._id,
      name: designation.title || designation.name,
      code: designation.code,
      hierarchyLevel,
      technicalRole: identity.definition.technicalRole,
    },
    employeeRole,
  };
};

const findEmployeeContext = async ({ employeeId, companyId, dependencies = {}, session = null }) => {
  const deps = depsFor(dependencies);
  const employee = await withSession(
    deps.User.findOne({ _id: employeeId, companyId, deletedAt: null }),
    session
  );
  if (!employee) throw new ApiError(404, "Sales employee not found");

  const [designation, department] = await Promise.all([
    employee.designationId
      ? withSession(deps.Designation.findOne({
          _id: employee.designationId,
          companyId,
          deletedAt: null,
        }), session)
      : null,
    employee.departmentId
      ? withSession(deps.Department.findOne({
          _id: employee.departmentId,
          companyId,
          deletedAt: null,
        }), session)
      : null,
  ]);

  return {
    employee,
    designation,
    department,
    identity: resolveSalesDesignationIdentity({ employee, designation, department }),
  };
};

const geographySummary = (geography) => geography ? ({
  id: geography._id,
  type: geography.type,
  name: geography.name,
  code: geography.code,
  parentId: geography.parentId || null,
  status: geography.status,
}) : null;

const resolveGeographyPathFromRecords = ({ records, geographyId, activeOnly = false }) => {
  const byId = new Map(records.map((record) => [toId(record._id), record]));
  const target = byId.get(toId(geographyId));
  if (!target || (activeOnly && (
    target.status !== "active" || target.isActive === false || target.isArchived === true
  ))) {
    throw new ApiError(404, activeOnly ? "Active Sales Geography not found" : "Sales Geography not found");
  }

  const reversed = [];
  const visited = new Set();
  let current = target;
  while (current) {
    const currentId = toId(current._id);
    if (visited.has(currentId)) throw new ApiError(409, "Sales Geography contains a parent cycle");
    visited.add(currentId);
    reversed.push(current);
    if (!current.parentId) break;
    current = byId.get(toId(current.parentId));
    if (!current) throw new ApiError(409, "Sales Geography parent chain is incomplete");
  }

  const recordsInPath = reversed.reverse();
  const expectedOrder = ["ZONE", "REGION", "BRANCH", "AREA"];
  recordsInPath.forEach((record, index) => {
    if (record.type !== expectedOrder[index]) {
      throw new ApiError(409, "Sales Geography parent chain has an invalid type relationship");
    }
  });
  if (activeOnly && recordsInPath.some((record) => (
    record.status !== "active" || record.isActive === false || record.isArchived === true
  ))) {
    throw new ApiError(409, "Sales Geography has an inactive parent in its path");
  }

  const path = { zone: null, region: null, branch: null, area: null };
  recordsInPath.forEach((record) => {
    path[record.type.toLowerCase()] = geographySummary(record);
  });
  return { target, records: recordsInPath, path };
};

const loadGeographyPath = async ({
  geographyId,
  companyId,
  activeOnly = false,
  dependencies = {},
  session = null,
}) => {
  const deps = depsFor(dependencies);
  const records = await withSession(
    deps.Geography.find({ companyId, deletedAt: null }),
    session
  );
  return resolveGeographyPathFromRecords({ records, geographyId, activeOnly });
};

const employeeSummary = (context) => ({
  id: context.employee._id,
  fullName: context.employee.fullName,
  employeeCode: context.employee.employeeId,
  status: context.employee.status,
  reportingManagerId: context.employee.reportingManagerId || context.employee.managerId || null,
  designation: context.identity.designation || null,
  hierarchyLevel: context.identity.hierarchyLevel || null,
  technicalRole: context.identity.technicalRole || getAccessRole(context.employee),
});

const assignmentSummary = (assignment, geographyPath = null) => assignment ? ({
  id: assignment._id,
  employeeId: assignment.employeeId,
  designationId: assignment.designationId,
  hierarchyLevel: assignment.hierarchyLevel,
  geographyId: assignment.geographyId,
  geographyType: assignment.geographyType,
  assignmentType: assignment.assignmentType,
  isResponsibleManager: assignment.isResponsibleManager,
  effectiveFrom: assignment.effectiveFrom,
  effectiveTo: assignment.effectiveTo,
  status: assignment.status,
  isCurrent: assignment.isCurrent,
  assignedBy: assignment.assignedBy,
  endedBy: assignment.endedBy,
  assignmentReason: assignment.assignmentReason || "",
  endReason: assignment.endReason || "",
  previousAssignmentId: assignment.previousAssignmentId || null,
  employeeGeography: geographyPath,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
}) : null;

const findCurrentAssignment = async ({ employeeId, companyId, dependencies = {}, session = null }) => {
  const deps = depsFor(dependencies);
  return withSession(deps.Assignment.findOne({
    companyId,
    employeeId,
    assignmentType: "PRIMARY",
    isCurrent: true,
    deletedAt: null,
  }), session);
};

const analyzeReportingCompatibility = async ({
  employeeContext,
  proposedPath,
  companyId,
  dependencies = {},
  session = null,
}) => {
  const managerId = employeeContext.employee.reportingManagerId || employeeContext.employee.managerId;
  if (!managerId) {
    return {
      status: REPORTING_COMPATIBILITY.NO_MANAGER,
      blocking: false,
      message: "Employee has no reporting manager; reporting was not changed",
      manager: null,
      managerAssignment: null,
    };
  }

  let managerContext;
  try {
    managerContext = await findEmployeeContext({ managerId, employeeId: managerId, companyId, dependencies, session });
  } catch (error) {
    if (error.statusCode === 404) {
      return {
        status: REPORTING_COMPATIBILITY.CROSS_DEPARTMENT,
        blocking: true,
        message: "Reporting manager is unavailable in this company",
        manager: null,
        managerAssignment: null,
      };
    }
    throw error;
  }

  if (!managerContext.identity.valid) {
    return {
      status: managerContext.identity.status === REPORTING_COMPATIBILITY.CROSS_DEPARTMENT
        ? REPORTING_COMPATIBILITY.CROSS_DEPARTMENT
        : REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
      blocking: true,
      message: managerContext.identity.message,
      manager: employeeSummary(managerContext),
      managerAssignment: null,
    };
  }
  if (managerContext.identity.hierarchyLevel <= employeeContext.identity.hierarchyLevel) {
    return {
      status: REPORTING_COMPATIBILITY.MANAGER_LEVEL_INVALID,
      blocking: true,
      message: "Reporting manager must have a higher Sales hierarchy level",
      manager: employeeSummary(managerContext),
      managerAssignment: null,
    };
  }
  if (managerContext.identity.hierarchyLevel === 6) {
    return {
      status: REPORTING_COMPATIBILITY.COMPATIBLE,
      blocking: false,
      message: "Head of Sales has company-wide Sales scope",
      manager: employeeSummary(managerContext),
      managerAssignment: null,
    };
  }

  const managerAssignment = await findCurrentAssignment({
    employeeId: managerContext.employee._id,
    companyId,
    dependencies,
    session,
  });
  if (!managerAssignment) {
    return {
      status: REPORTING_COMPATIBILITY.MANAGER_NOT_ASSIGNED,
      blocking: false,
      message: "Reporting manager has no current Geography assignment; assign top-down when possible",
      manager: employeeSummary(managerContext),
      managerAssignment: null,
    };
  }

  const proposedIds = new Set(proposedPath.records.map((record) => toId(record._id)));
  if (!proposedIds.has(toId(managerAssignment.geographyId))) {
    const managerPath = await loadGeographyPath({
      geographyId: managerAssignment.geographyId,
      companyId,
      dependencies,
      session,
    });
    return {
      status: REPORTING_COMPATIBILITY.GEOGRAPHY_MISMATCH,
      blocking: false,
      message: "Reporting manager Geography does not contain the proposed employee Geography; assignment is allowed",
      manager: employeeSummary(managerContext),
      managerAssignment: assignmentSummary(managerAssignment, managerPath.path),
    };
  }

  const managerPath = await loadGeographyPath({
    geographyId: managerAssignment.geographyId,
    companyId,
    dependencies,
    session,
  });
  return {
    status: REPORTING_COMPATIBILITY.COMPATIBLE,
    blocking: false,
    message: "Reporting manager Geography contains the proposed employee Geography",
    manager: employeeSummary(managerContext),
    managerAssignment: assignmentSummary(managerAssignment, managerPath.path),
  };
};

const buildAssignmentPreview = async ({
  payload,
  user,
  dependencies = {},
  session = null,
  authorize = true,
}) => {
  const companyId = authorize ? assertCanManageAssignments(user) : getCompanyIdOrThrow(user);
  const deps = depsFor(dependencies);
  const warnings = [];
  const blockingConflicts = [];
  const employeeContext = await findEmployeeContext({
    employeeId: payload.employeeId,
    companyId,
    dependencies,
    session,
  });

  if (employeeContext.employee.status !== "active") {
    blockingConflicts.push("Inactive employees cannot receive a current Sales Geography assignment");
  }
  if (!employeeContext.identity.valid) {
    blockingConflicts.push(employeeContext.identity.message);
  }
  if (employeeContext.identity.hierarchyLevel === 6) {
    blockingConflicts.push("Head of Sales has company-wide scope and does not receive a Geography assignment");
  }

  let proposedPath = null;
  try {
    proposedPath = await loadGeographyPath({
      geographyId: payload.geographyId,
      companyId,
      activeOnly: true,
      dependencies,
      session,
    });
  } catch (error) {
    if ([404, 409].includes(error.statusCode)) blockingConflicts.push(error.message);
    else throw error;
  }

  if (
    proposedPath && employeeContext.identity.expectedGeographyType &&
    proposedPath.target.type !== employeeContext.identity.expectedGeographyType
  ) {
    blockingConflicts.push(
      `L${employeeContext.identity.hierarchyLevel} employees require ${employeeContext.identity.expectedGeographyType} Geography`
    );
  }

  const currentAssignment = await findCurrentAssignment({
    employeeId: employeeContext.employee._id,
    companyId,
    dependencies,
    session,
  });
  const currentPath = currentAssignment
    ? await loadGeographyPath({ geographyId: currentAssignment.geographyId, companyId, dependencies, session })
    : null;
  const sameCurrentGeography = currentAssignment && sameId(currentAssignment.geographyId, payload.geographyId);
  if (currentAssignment && !sameCurrentGeography && String(payload.reason || "").trim().length < 2) {
    blockingConflicts.push("A reason is required for reassignment");
  }
  if (sameCurrentGeography) warnings.push("Employee is already assigned to the proposed Geography");

  let responsibleAssignment = null;
  let responsibleEmployee = null;
  if (proposedPath && isResponsibleManagementLevel(employeeContext.identity.hierarchyLevel)) {
    responsibleAssignment = await withSession(deps.Assignment.findOne({
      companyId,
      geographyId: proposedPath.target._id,
      isResponsibleManager: true,
      isCurrent: true,
      deletedAt: null,
    }), session);
    if (responsibleAssignment && !sameId(responsibleAssignment.employeeId, employeeContext.employee._id)) {
      responsibleEmployee = await withSession(deps.User.findOne({
        _id: responsibleAssignment.employeeId,
        companyId,
        deletedAt: null,
      }), session);
      if (payload.replaceCurrentHolder !== true) {
        blockingConflicts.push(
          `${proposedPath.target.type} already has a current responsible employee; explicit replacement is required`
        );
      } else if (String(payload.reason || "").trim().length < 2) {
        blockingConflicts.push("A reason is required to replace the current responsible employee");
      } else {
        warnings.push("Applying this assignment will end the current responsible employee assignment");
      }
    }
  }

  let compatibility = {
    status: REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
    blocking: true,
    message: "Compatibility cannot be evaluated until employee and Geography validation succeeds",
    manager: null,
    managerAssignment: null,
  };
  if (employeeContext.identity.valid && employeeContext.identity.hierarchyLevel < 6 && proposedPath) {
    const hasManagerOverride = Object.prototype.hasOwnProperty.call(payload, "reportingManagerIdOverride");
    const reportingEmployee = hasManagerOverride
      ? {
          ...(employeeContext.employee.toObject?.() || employeeContext.employee),
          reportingManagerId: payload.reportingManagerIdOverride || null,
          managerId: payload.reportingManagerIdOverride || null,
        }
      : employeeContext.employee;
    compatibility = await analyzeReportingCompatibility({
      employeeContext: hasManagerOverride
        ? { ...employeeContext, employee: reportingEmployee }
        : employeeContext,
      proposedPath,
      companyId,
      dependencies,
      session,
    });
    if (compatibility.blocking) blockingConflicts.push(compatibility.message);
    else if (compatibility.status !== REPORTING_COMPATIBILITY.COMPATIBLE) warnings.push(compatibility.message);
  }

  const operation = sameCurrentGeography
    ? "NO_CHANGE"
    : currentAssignment ? "REASSIGNMENT" : "INITIAL_ASSIGNMENT";

  return {
    canApply: blockingConflicts.length === 0,
    operation,
    effectiveFrom: deps.now(),
    employee: employeeSummary(employeeContext),
    expectedGeographyType: employeeContext.identity.expectedGeographyType || null,
    currentAssignment: assignmentSummary(currentAssignment, currentPath?.path || null),
    proposedGeography: proposedPath ? geographySummary(proposedPath.target) : null,
    proposedGeographyPath: proposedPath?.path || null,
    reportingCompatibility: compatibility,
    uniquenessConflict: responsibleAssignment && !sameId(
      responsibleAssignment.employeeId,
      employeeContext.employee._id
    ) ? {
      assignmentId: responsibleAssignment._id,
      employeeId: responsibleAssignment.employeeId,
      employeeName: responsibleEmployee?.fullName || "Current holder",
      requiresExplicitReplacement: true,
    } : null,
    warnings,
    blockingConflicts: [...new Set(blockingConflicts)],
  };
};

const previewSalesGeographyAssignment = (options) => buildAssignmentPreview(options);

const closeAssignment = async ({ assignment, actorId, reason, effectiveTo, session }) => {
  assignment.isCurrent = false;
  assignment.status = "ended";
  assignment.effectiveTo = effectiveTo;
  assignment.endedBy = actorId;
  assignment.endReason = reason;
  await assignment.save({ session, validateModifiedOnly: true });
  return assignment;
};

const writeAssignmentAudit = ({
  action,
  assignment,
  companyId,
  actorId,
  oldGeographyId = null,
  newGeographyId = null,
  reason = "",
  relatedAssignmentId = null,
  req = null,
  session = null,
  dependencies = {},
}) => depsFor(dependencies).writeAuditLog({
  companyId,
  actorId,
  action,
  entityType: "SalesEmployeeGeographyAssignment",
  entityId: assignment._id,
  metadata: {
    employeeId: assignment.employeeId,
    hierarchyLevel: assignment.hierarchyLevel,
    oldGeographyId,
    newGeographyId,
    effectiveAt: assignment.isCurrent ? assignment.effectiveFrom : assignment.effectiveTo,
    reason,
    assignmentId: assignment._id,
    relatedAssignmentId,
  },
  req,
  session,
});

const mapAssignmentConflict = (error) => {
  if (isDuplicateKeyError(error)) {
    return new ApiError(409, "A conflicting current Sales Geography assignment was created concurrently");
  }
  return error;
};

const applySalesGeographyAssignmentInSession = async ({
  payload,
  user,
  req = null,
  companyId,
  session,
  dependencies = {},
  preview = null,
  effectiveAt = null,
  writeAudits = true,
}) => {
  const deps = depsFor(dependencies);
  const resolvedPreview = preview || await buildAssignmentPreview({
    payload,
    user,
    dependencies,
    session,
  });
  if (!resolvedPreview.canApply) {
    throw new ApiError(409, "Sales Geography assignment preview contains blocking conflicts", resolvedPreview.blockingConflicts);
  }
  if (resolvedPreview.operation === "NO_CHANGE") {
    return {
      operation: "NO_CHANGE",
      preview: resolvedPreview,
      assignment: null,
      currentAssignment: null,
      displacedAssignment: null,
      effectiveAt: effectiveAt || deps.now(),
    };
  }

  const appliedAt = effectiveAt || deps.now();
  const currentAssignment = await findCurrentAssignment({
    employeeId: payload.employeeId,
    companyId,
    dependencies,
    session,
  });
  let displacedAssignment = null;

  if (resolvedPreview.uniquenessConflict) {
    displacedAssignment = await withSession(deps.Assignment.findOne({
      _id: resolvedPreview.uniquenessConflict.assignmentId,
      companyId,
      isCurrent: true,
      deletedAt: null,
    }), session);
    if (!displacedAssignment) {
      throw new ApiError(409, "Current responsible employee changed; preview the assignment again");
    }
    await closeAssignment({
      assignment: displacedAssignment,
      actorId: user._id,
      reason: payload.reason,
      effectiveTo: appliedAt,
      session,
    });
    if (writeAudits) {
      await writeAssignmentAudit({
        action: "SALES_EMPLOYEE_GEOGRAPHY_ENDED",
        assignment: displacedAssignment,
        companyId,
        actorId: user._id,
        oldGeographyId: displacedAssignment.geographyId,
        reason: payload.reason,
        req,
        session,
        dependencies,
      });
    }
  }

  if (currentAssignment) {
    await closeAssignment({
      assignment: currentAssignment,
      actorId: user._id,
      reason: payload.reason,
      effectiveTo: appliedAt,
      session,
    });
  }

  const [newAssignment] = await deps.Assignment.create([{
    companyId,
    employeeId: payload.employeeId,
    designationId: resolvedPreview.employee.designation.id,
    hierarchyLevel: resolvedPreview.employee.hierarchyLevel,
    geographyId: payload.geographyId,
    geographyType: resolvedPreview.expectedGeographyType,
    assignmentType: "PRIMARY",
    isResponsibleManager: isResponsibleManagementLevel(resolvedPreview.employee.hierarchyLevel),
    effectiveFrom: appliedAt,
    effectiveTo: null,
    status: "current",
    isCurrent: true,
    assignedBy: user._id,
    assignmentReason: payload.reason || "",
    previousAssignmentId: currentAssignment?._id || null,
  }], { session });

  if (writeAudits) {
    await writeAssignmentAudit({
      action: currentAssignment
        ? "SALES_EMPLOYEE_GEOGRAPHY_REASSIGNED"
        : "SALES_EMPLOYEE_GEOGRAPHY_ASSIGNED",
      assignment: newAssignment,
      companyId,
      actorId: user._id,
      oldGeographyId: currentAssignment?.geographyId || null,
      newGeographyId: newAssignment.geographyId,
      reason: payload.reason || "",
      relatedAssignmentId: currentAssignment?._id || displacedAssignment?._id || null,
      req,
      session,
      dependencies,
    });
  }

  return {
    operation: resolvedPreview.operation,
    preview: resolvedPreview,
    assignment: newAssignment,
    currentAssignment,
    displacedAssignment,
    effectiveAt: appliedAt,
  };
};

const assignSalesGeography = async ({ payload, user, req = null, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  let newAssignment = null;
  let preview = null;

  try {
    preview = await buildAssignmentPreview({ payload, user, dependencies, session });
    const applied = await applySalesGeographyAssignmentInSession({
      payload,
      user,
      req,
      companyId,
      session,
      dependencies,
      preview,
      effectiveAt: deps.now(),
    });
    if (applied.operation === "NO_CHANGE") {
      await session.abortTransaction();
      return preview.currentAssignment;
    }
    newAssignment = applied.assignment;

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw mapAssignmentConflict(error);
  } finally {
    await session.endSession();
  }

  const path = await loadGeographyPath({
    geographyId: newAssignment.geographyId,
    companyId,
    dependencies,
  });
  return assignmentSummary(newAssignment, path.path);
};

const endSalesGeographyAssignmentInSession = async ({
  employeeId,
  reason,
  user,
  req = null,
  companyId,
  session,
  dependencies = {},
  effectiveAt = null,
  writeAudits = true,
}) => {
  const deps = depsFor(dependencies);
  await findEmployeeContext({ employeeId, companyId, dependencies, session });
  const assignment = await findCurrentAssignment({ employeeId, companyId, dependencies, session });
  if (!assignment) throw new ApiError(404, "Current Sales Geography assignment not found");
  const endedAt = effectiveAt || deps.now();
  await closeAssignment({ assignment, actorId: user._id, reason, effectiveTo: endedAt, session });
  if (writeAudits) {
    await writeAssignmentAudit({
      action: "SALES_EMPLOYEE_GEOGRAPHY_ENDED",
      assignment,
      companyId,
      actorId: user._id,
      oldGeographyId: assignment.geographyId,
      reason,
      req,
      session,
      dependencies,
    });
  }
  return { assignment, effectiveAt: endedAt };
};

const endCurrentSalesGeographyAssignment = async ({
  employeeId,
  reason,
  user,
  req = null,
  dependencies = {},
}) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  let assignment;
  try {
    const ended = await endSalesGeographyAssignmentInSession({
      employeeId,
      reason,
      user,
      req,
      companyId,
      session,
      dependencies,
      effectiveAt: deps.now(),
    });
    assignment = ended.assignment;
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw mapAssignmentConflict(error);
  } finally {
    await session.endSession();
  }
  const path = await loadGeographyPath({ geographyId: assignment.geographyId, companyId, dependencies });
  return assignmentSummary(assignment, path.path);
};

const hydrateAssignment = async ({ assignment, companyId, dependencies = {} }) => {
  if (!assignment) return null;
  const [path, employeeContext] = await Promise.all([
    loadGeographyPath({ geographyId: assignment.geographyId, companyId, dependencies }),
    findEmployeeContext({ employeeId: assignment.employeeId, companyId, dependencies }),
  ]);
  return {
    ...assignmentSummary(assignment, path.path),
    employee: employeeSummary(employeeContext),
    healthStatus: employeeContext.employee.status !== "active"
      ? "EMPLOYEE_INACTIVE"
      : path.target.status !== "active" || path.target.isArchived === true
        ? "GEOGRAPHY_INACTIVE"
        : "ACTIVE",
  };
};

const getCurrentAssignmentForEmployee = async ({
  employeeId,
  user,
  ownOnly = false,
  dependencies = {},
}) => {
  const companyId = ownOnly ? assertCanReadOwnAssignment(user) : assertCanManageAssignments(user);
  if (ownOnly && !sameId(employeeId, user._id)) throw new ApiError(403, "Only your own assignment is available");
  await findEmployeeContext({ employeeId, companyId, dependencies });
  const assignment = await findCurrentAssignment({ employeeId, companyId, dependencies });
  return hydrateAssignment({ assignment, companyId, dependencies });
};

const getAssignmentHistoryForEmployee = async ({ employeeId, user, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  await findEmployeeContext({ employeeId, companyId, dependencies });
  const records = await deps.Assignment.find({ companyId, employeeId, deletedAt: null });
  records.sort((first, second) => new Date(second.effectiveFrom) - new Date(first.effectiveFrom));
  return Promise.all(records.map((assignment) => hydrateAssignment({ assignment, companyId, dependencies })));
};

const getCurrentAssignmentsForGeography = async ({ geographyId, user, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  await loadGeographyPath({ geographyId, companyId, dependencies });
  const records = await deps.Assignment.find({ companyId, geographyId, isCurrent: true, deletedAt: null });
  return Promise.all(records.map((assignment) => hydrateAssignment({ assignment, companyId, dependencies })));
};

const deriveSalesPlacementStatus = ({
  context,
  currentAssignment = null,
  reportingCompatibility = null,
}) => {
  if (!isSalesDepartment(context.department)) {
    return { applicable: false, status: ASSIGNMENT_READINESS.NOT_APPLICABLE };
  }
  if (context.employee.status !== "active") {
    return { applicable: true, status: ASSIGNMENT_READINESS.INACTIVE };
  }
  if (!context.identity.valid) {
    return {
      applicable: true,
      status: context.identity.status === ASSIGNMENT_READINESS.MISSING_LEVEL
        ? ASSIGNMENT_READINESS.MISSING_LEVEL
        : ASSIGNMENT_READINESS.AMBIGUOUS_DESIGNATION,
    };
  }
  if (context.identity.hierarchyLevel === 6) {
    return { applicable: true, status: ASSIGNMENT_READINESS.NOT_APPLICABLE };
  }
  if (!currentAssignment) {
    return { applicable: true, status: ASSIGNMENT_READINESS.UNASSIGNED };
  }
  if (reportingCompatibility?.blocking) {
    return { applicable: true, status: ASSIGNMENT_READINESS.REPORTING_CONFLICT };
  }
  return { applicable: true, status: ASSIGNMENT_READINESS.READY };
};

const evaluateSalesPlacementForEmployee = async ({
  employeeId,
  companyId,
  dependencies = {},
}) => {
  const context = await findEmployeeContext({ employeeId, companyId, dependencies });
  const initial = deriveSalesPlacementStatus({ context });
  if (!initial.applicable) {
    return {
      applicable: false,
      hierarchyLevel: null,
      designation: null,
      technicalRole: getAccessRole(context.employee),
      geographyType: null,
      status: ASSIGNMENT_READINESS.NOT_APPLICABLE,
      currentGeography: null,
      assignmentIssue: null,
      reportingCompatibility: null,
    };
  }

  const currentAssignment = await findCurrentAssignment({
    employeeId: context.employee._id,
    companyId,
    dependencies,
  });
  let currentPath = null;
  let reportingCompatibility = null;
  if (currentAssignment) {
    try {
      currentPath = await loadGeographyPath({
        geographyId: currentAssignment.geographyId,
        companyId,
        dependencies,
      });
      if (context.identity.valid && context.identity.hierarchyLevel < 6) {
        reportingCompatibility = await analyzeReportingCompatibility({
          employeeContext: context,
          proposedPath: currentPath,
          companyId,
          dependencies,
        });
      }
    } catch (error) {
      if (![404, 409].includes(error.statusCode)) throw error;
      reportingCompatibility = {
        status: REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
        blocking: true,
        message: error.message,
      };
    }
  }

  const placement = deriveSalesPlacementStatus({
    context,
    currentAssignment,
    reportingCompatibility,
  });
  return {
    applicable: placement.applicable,
    hierarchyLevel: context.identity.hierarchyLevel || null,
    designation: context.identity.designation || null,
    technicalRole: context.identity.technicalRole || getAccessRole(context.employee),
    geographyType: context.identity.expectedGeographyType || null,
    status: placement.status,
    currentGeography: currentPath?.path || null,
    assignmentIssue: context.identity.valid ? null : context.identity.message,
    reportingCompatibility,
  };
};

const listCompatibleGeographiesForEmployee = async ({
  employeeId,
  user,
  dependencies = {},
}) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const context = await findEmployeeContext({ employeeId, companyId, dependencies });
  const basePlacement = deriveSalesPlacementStatus({ context });
  if (!basePlacement.applicable || !context.identity.valid || context.identity.hierarchyLevel === 6) {
    return {
      employee: employeeSummary(context),
      expectedGeographyType: context.identity.expectedGeographyType || null,
      options: [],
      managerScope: null,
      warning: context.identity.hierarchyLevel === 6
        ? "Head of Sales has complete company Sales scope and requires no Geography assignment"
        : context.identity.message || "Geography placement is not applicable",
    };
  }
  if (context.employee.status !== "active") {
    return {
      employee: employeeSummary(context),
      expectedGeographyType: context.identity.expectedGeographyType,
      options: [],
      managerScope: null,
      warning: "Inactive employees cannot receive a current Sales Geography assignment",
    };
  }

  const records = await deps.Geography.find({ companyId, deletedAt: null });
  const candidatePaths = records
    .filter((geography) => (
      geography.type === context.identity.expectedGeographyType &&
      geography.status === "active" &&
      geography.isActive !== false &&
      geography.isArchived !== true
    ))
    .map((geography) => resolveGeographyPathFromRecords({
      records,
      geographyId: geography._id,
      activeOnly: true,
    }));

  if (!candidatePaths.length) {
    return {
      employee: employeeSummary(context),
      expectedGeographyType: context.identity.expectedGeographyType,
      options: [],
      managerScope: null,
      warning: `No active ${context.identity.expectedGeographyType} Geography is available`,
    };
  }

  const compatibility = await analyzeReportingCompatibility({
    employeeContext: context,
    proposedPath: candidatePaths[0],
    companyId,
    dependencies,
  });
  const managerGeographyId = compatibility.managerAssignment?.geographyId || null;
  let compatiblePaths = candidatePaths;
  let managerScope = null;
  let warning = null;

  if (managerGeographyId) {
    compatiblePaths = candidatePaths.filter((candidate) => (
      candidate.records.some((record) => sameId(record._id, managerGeographyId))
    ));
    managerScope = {
      applied: true,
      manager: compatibility.manager,
      geography: compatibility.managerAssignment.employeeGeography,
      message: "Options are limited to Geography contained by the reporting manager assignment",
    };
  } else if (compatibility.blocking) {
    compatiblePaths = [];
    warning = compatibility.message;
  } else if (compatibility.status !== REPORTING_COMPATIBILITY.COMPATIBLE) {
    warning = compatibility.message;
  }

  return {
    employee: employeeSummary(context),
    expectedGeographyType: context.identity.expectedGeographyType,
    options: compatiblePaths
      .map((candidate) => ({ ...geographySummary(candidate.target), path: candidate.path }))
      .sort((first, second) => String(first.name || "").localeCompare(String(second.name || ""))),
    managerScope,
    warning,
    reportingCompatibility: compatibility,
  };
};

const listSalesAssignmentReadiness = async ({ user, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const [departments, assignments] = await Promise.all([
    deps.Department.find({ companyId, deletedAt: null }),
    deps.Assignment.find({ companyId, isCurrent: true, deletedAt: null }),
  ]);
  const salesDepartmentIds = departments.filter(isSalesDepartment).map((item) => item._id);
  if (!salesDepartmentIds.length) return [];
  const employees = await deps.User.find({
    companyId,
    departmentId: { $in: salesDepartmentIds },
    deletedAt: null,
  });
  const designationIds = [...new Set(employees.map((item) => toId(item.designationId)).filter(Boolean))];
  const designations = designationIds.length
    ? await deps.Designation.find({ _id: { $in: designationIds }, companyId, deletedAt: null })
    : [];
  const designationById = new Map(designations.map((item) => [toId(item._id), item]));
  const departmentById = new Map(departments.map((item) => [toId(item._id), item]));
  const assignmentByEmployee = new Map(assignments.map((item) => [toId(item.employeeId), item]));
  const employeeById = new Map(employees.map((item) => [toId(item._id), item]));

  const readinessRows = await Promise.all(employees.map(async (employee) => {
    const context = {
      employee,
      designation: designationById.get(toId(employee.designationId)) || null,
      department: departmentById.get(toId(employee.departmentId)) || null,
    };
    context.identity = resolveSalesDesignationIdentity(context);
    const current = assignmentByEmployee.get(toId(employee._id)) || null;
    let currentPath = null;
    let currentPathError = null;
    if (current) {
      try {
        currentPath = await loadGeographyPath({
          geographyId: current.geographyId,
          companyId,
          dependencies,
        });
      } catch (error) {
        if ([404, 409].includes(error.statusCode)) currentPathError = error;
        else throw error;
      }
    }
    let readiness = deriveSalesPlacementStatus({ context, currentAssignment: current }).status;

    let reportingCompatibility = null;
    if (
      readiness === ASSIGNMENT_READINESS.READY &&
      current &&
      context.identity.valid &&
      context.identity.hierarchyLevel < 6
    ) {
      try {
        if (currentPathError) throw currentPathError;
        reportingCompatibility = await analyzeReportingCompatibility({
          employeeContext: context,
          proposedPath: currentPath,
          companyId,
          dependencies,
        });
        if (reportingCompatibility.blocking) readiness = ASSIGNMENT_READINESS.REPORTING_CONFLICT;
      } catch (error) {
        if ([404, 409].includes(error.statusCode)) {
          readiness = ASSIGNMENT_READINESS.REPORTING_CONFLICT;
          reportingCompatibility = {
            status: REPORTING_COMPATIBILITY.LEGACY_ASSIGNMENT_CONFLICT,
            blocking: true,
            message: error.message,
          };
        } else throw error;
      }
      readiness = deriveSalesPlacementStatus({
        context,
        currentAssignment: current,
        reportingCompatibility,
      }).status;
    }

    return {
      ...employeeSummary(context),
      reportingManager: employee.reportingManagerId || employee.managerId ? {
        id: employee.reportingManagerId || employee.managerId,
        fullName: employeeById.get(toId(employee.reportingManagerId || employee.managerId))?.fullName || "Unavailable manager",
      } : null,
      expectedGeographyType: context.identity.expectedGeographyType || null,
      readiness,
      currentAssignment: assignmentSummary(current, currentPath?.path || null),
      assignmentIssue: context.identity.valid ? null : context.identity.message,
      reportingCompatibility,
    };
  }));
  return readinessRows.sort(
    (first, second) => String(first.fullName || "").localeCompare(String(second.fullName || ""))
  );
};

const buildSalesAssignmentTree = async ({ user, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const [geographies, assignments] = await Promise.all([
    deps.Geography.find({ companyId, deletedAt: null }),
    deps.Assignment.find({ companyId, isCurrent: true, deletedAt: null }),
  ]);
  const employeeIds = [...new Set(assignments.map((item) => toId(item.employeeId)).filter(Boolean))];
  const employees = employeeIds.length
    ? await deps.User.find({ _id: { $in: employeeIds }, companyId, deletedAt: null })
    : [];
  const employeeById = new Map(employees.map((item) => [toId(item._id), item]));
  const assignmentsByGeography = new Map();
  assignments.forEach((assignment) => {
    const key = toId(assignment.geographyId);
    const rows = assignmentsByGeography.get(key) || [];
    rows.push({
      ...assignmentSummary(assignment),
      employee: {
        id: assignment.employeeId,
        fullName: employeeById.get(toId(assignment.employeeId))?.fullName || "Unavailable employee",
        status: employeeById.get(toId(assignment.employeeId))?.status || "unavailable",
      },
    });
    assignmentsByGeography.set(key, rows);
  });

  const childrenByParent = new Map();
  geographies.forEach((geography) => {
    const key = toId(geography.parentId);
    const rows = childrenByParent.get(key) || [];
    rows.push(geography);
    childrenByParent.set(key, rows);
  });
  const mapNode = (geography) => {
    const nodeAssignments = assignmentsByGeography.get(toId(geography._id)) || [];
    const responsibleManager = nodeAssignments.find((item) => item.isResponsibleManager) || null;
    const fieldSalesExecutives = nodeAssignments.filter((item) => item.hierarchyLevel === 1);
    const children = (childrenByParent.get(toId(geography._id)) || [])
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(mapNode);
    const node = {
      ...geographySummary(geography),
      responsibleManager,
      fieldSalesExecutives,
    };
    if (geography.type === "ZONE") node.regions = children;
    if (geography.type === "REGION") node.branches = children;
    if (geography.type === "BRANCH") node.areas = children;
    return node;
  };
  return geographies
    .filter((item) => item.type === "ZONE" && !item.parentId)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(mapNode);
};

module.exports = {
  assertCanManageAssignments,
  assertCanReadOwnAssignment,
  resolveSalesDesignationIdentity,
  findEmployeeContext,
  findCurrentAssignment,
  employeeSummary,
  assignmentSummary,
  deriveSalesPlacementStatus,
  evaluateSalesPlacementForEmployee,
  loadGeographyPath,
  analyzeReportingCompatibility,
  previewSalesGeographyAssignment,
  applySalesGeographyAssignmentInSession,
  assignSalesGeography,
  endSalesGeographyAssignmentInSession,
  endCurrentSalesGeographyAssignment,
  getCurrentAssignmentForEmployee,
  getAssignmentHistoryForEmployee,
  getCurrentAssignmentsForGeography,
  listCompatibleGeographiesForEmployee,
  listSalesAssignmentReadiness,
  buildSalesAssignmentTree,
};
