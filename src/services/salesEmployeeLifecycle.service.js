const mongoose = require("mongoose");
const User = require("../models/User");
const Department = require("../models/Department");
const Designation = require("../models/Designation");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const SalesEmployeeLifecycleEvent = require("../models/SalesEmployeeLifecycleEvent");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const { canManageEmployeeRecords } = require("./permission.service");
const {
  validateReportingManagerAssignment,
  getAllowedManagersForEmployee,
} = require("./reporting.service");
const { writeAuditLog } = require("./auditLog.service");
const { invalidateOrgTreeCache } = require("./orgTree.service");
const { isSalesDepartment } = require("../constants/salesHierarchy");
const { REPORTING_COMPATIBILITY } = require("../constants/salesGeographyAssignment");
const {
  assertCanManageAssignments,
  findEmployeeContext,
  findCurrentAssignment,
  employeeSummary,
  assignmentSummary,
  loadGeographyPath,
  analyzeReportingCompatibility,
  previewSalesGeographyAssignment,
  applySalesGeographyAssignmentInSession,
  endSalesGeographyAssignmentInSession,
} = require("./salesGeographyAssignment.service");

const LIFECYCLE_TYPES = Object.freeze({
  GEOGRAPHY_TRANSFER: "GEOGRAPHY_TRANSFER",
  REPORTING_MANAGER_CHANGE: "REPORTING_MANAGER_CHANGE",
  GEOGRAPHY_AND_MANAGER_TRANSFER: "GEOGRAPHY_AND_MANAGER_TRANSFER",
  END_ASSIGNMENT: "END_ASSIGNMENT",
  EMPLOYEE_OFFBOARDING: "EMPLOYEE_OFFBOARDING",
});

const PERMANENT_OFFBOARDING_STATUSES = Object.freeze(["disabled", "deleted"]);

const DEFAULT_DEPS = {
  User,
  Department,
  Designation,
  Geography: SalesGeography,
  Assignment: SalesEmployeeGeographyAssignment,
  LifecycleEvent: SalesEmployeeLifecycleEvent,
  validateReportingManagerAssignment,
  getAllowedManagersForEmployee,
  writeAuditLog,
  invalidateOrgTreeCache,
  startSession: () => mongoose.startSession(),
  now: () => new Date(),
  newOperationId: () => new mongoose.Types.ObjectId(),
};

const depsFor = (dependencies = {}) => ({ ...DEFAULT_DEPS, ...dependencies });
const toId = (value) => String(value?._id || value?.id || value || "");
const sameId = (first, second) => toId(first) === toId(second);
const withSession = (query, session) => session && query?.session ? query.session(session) : query;
const cleanReason = (value) => String(value || "").trim().replace(/\s+/g, " ");

const requireReason = (reason) => {
  const normalized = cleanReason(reason);
  if (normalized.length < 2) throw new ApiError(400, "A transfer reason is required");
  if (normalized.length > 500) throw new ApiError(400, "Transfer reason must be 500 characters or less");
  return normalized;
};

const assignmentDependencies = (deps) => ({
  User: deps.User,
  Department: deps.Department,
  Designation: deps.Designation,
  Geography: deps.Geography,
  Assignment: deps.Assignment,
  writeAuditLog: deps.writeAuditLog,
  startSession: deps.startSession,
  now: deps.now,
});

const assertLifecycleEmployee = (context, { allowHead = false } = {}) => {
  if (!isSalesDepartment(context.department)) throw new ApiError(400, "Sales lifecycle operations require a Sales employee");
  if (!context.identity.valid) throw new ApiError(409, context.identity.message);
  if (context.identity.hierarchyLevel === 6 && !allowHead) {
    throw new ApiError(409, "Head of Sales remains under existing HOD lifecycle governance");
  }
  return context;
};

const managerIdFor = (employee) => employee.reportingManagerId || employee.managerId || null;

const contextWithManager = (context, reportingManagerId) => ({
  ...context,
  employee: {
    ...(context.employee.toObject?.() || context.employee),
    reportingManagerId: reportingManagerId || null,
    managerId: reportingManagerId || null,
  },
});

const getDirectReportImpact = async ({
  employeeContext,
  proposedManagerPath,
  companyId,
  session = null,
  dependencies = {},
}) => {
  const deps = depsFor(dependencies);
  const directReports = await withSession(deps.User.find({
    companyId,
    status: "active",
    deletedAt: null,
    $or: [
      { reportingManagerId: employeeContext.employee._id },
      { managerId: employeeContext.employee._id },
    ],
  }), session);

  return Promise.all(directReports.map(async (employee) => {
    let reportContext = null;
    try {
      reportContext = await findEmployeeContext({
        employeeId: employee._id,
        companyId,
        dependencies: assignmentDependencies(deps),
        session,
      });
    } catch (error) {
      return {
        employee: { id: employee._id, fullName: employee.fullName },
        currentGeography: null,
        compatibility: "UNRESOLVED_REPORT",
        blocking: true,
        message: error.message,
      };
    }

    const currentAssignment = await findCurrentAssignment({
      employeeId: employee._id,
      companyId,
      dependencies: assignmentDependencies(deps),
      session,
    });
    if (!currentAssignment) {
      return {
        employee: employeeSummary(reportContext),
        currentGeography: null,
        compatibility: "REPORT_UNASSIGNED",
        blocking: false,
        message: "Direct report is currently unassigned; Geography compatibility is not yet known",
      };
    }
    const currentPath = await loadGeographyPath({
      geographyId: currentAssignment.geographyId,
      companyId,
      dependencies: assignmentDependencies(deps),
      session,
    });
    if (!proposedManagerPath) {
      return {
        employee: employeeSummary(reportContext),
        currentGeography: currentPath.path,
        compatibility: "MANAGER_WILL_BE_UNASSIGNED",
        blocking: false,
        message: "Direct report remains assigned while this manager position becomes vacant",
      };
    }
    const compatible = currentPath.records.some((record) => sameId(record._id, proposedManagerPath.target._id));
    return {
      employee: employeeSummary(reportContext),
      currentGeography: currentPath.path,
      compatibility: compatible ? "COMPATIBLE" : "GEOGRAPHY_MISMATCH",
      blocking: !compatible,
      message: compatible
        ? "Direct report remains within the manager's proposed Geography scope"
        : "Direct report Geography would fall outside the manager's proposed scope",
    };
  }));
};

const getCompatibleReportingManagers = async ({
  employeeId,
  geographyId,
  user,
  session = null,
  dependencies = {},
}) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const context = assertLifecycleEmployee(await findEmployeeContext({
    employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  }));
  const currentAssignment = geographyId ? null : await findCurrentAssignment({
    employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  const targetGeographyId = geographyId || currentAssignment?.geographyId;
  if (!targetGeographyId) {
    return { employee: employeeSummary(context), geography: null, candidates: [], warning: "Select Geography before selecting a reporting manager" };
  }
  const employeePath = await loadGeographyPath({
    geographyId: targetGeographyId,
    companyId,
    activeOnly: true,
    dependencies: assignmentDependencies(deps),
    session,
  });
  if (employeePath.target.type !== context.identity.expectedGeographyType) {
    throw new ApiError(400, `L${context.identity.hierarchyLevel} employees require ${context.identity.expectedGeographyType} Geography`);
  }

  const allowed = await deps.getAllowedManagersForEmployee({
    companyId,
    departmentId: context.employee.departmentId,
    designationId: context.employee.designationId,
    excludeUserId: context.employee._id,
    actorUser: user,
  });
  const candidates = [];
  for (const allowedManager of allowed) {
    let managerContext;
    try {
      managerContext = assertLifecycleEmployee(await findEmployeeContext({
        employeeId: allowedManager.id || allowedManager._id,
        companyId,
        dependencies: assignmentDependencies(deps),
        session,
      }), { allowHead: true });
    } catch {
      continue;
    }
    if (managerContext.identity.hierarchyLevel <= context.identity.hierarchyLevel) continue;
    if (managerContext.identity.hierarchyLevel === 6) {
      candidates.push({
        ...allowedManager,
        hierarchyLevel: 6,
        geography: null,
        compatibility: "COMPATIBLE",
        relationship: "Complete Sales Organization scope",
      });
      continue;
    }
    const managerAssignment = await findCurrentAssignment({
      employeeId: managerContext.employee._id,
      companyId,
      dependencies: assignmentDependencies(deps),
      session,
    });
    if (!managerAssignment) continue;
    if (!employeePath.records.some((record) => sameId(record._id, managerAssignment.geographyId))) continue;
    const managerPath = await loadGeographyPath({
      geographyId: managerAssignment.geographyId,
      companyId,
      dependencies: assignmentDependencies(deps),
      session,
    });
    candidates.push({
      ...allowedManager,
      hierarchyLevel: managerContext.identity.hierarchyLevel,
      geography: managerPath.path,
      compatibility: "COMPATIBLE",
      relationship: managerContext.identity.hierarchyLevel === context.identity.hierarchyLevel + 1
        ? "Nearest valid manager level"
        : "Compatible skip-level manager",
    });
  }
  candidates.sort((first, second) => (
    Number(first.hierarchyLevel) - Number(second.hierarchyLevel) ||
    String(first.fullName || "").localeCompare(String(second.fullName || ""))
  ));
  return {
    employee: employeeSummary(context),
    geography: employeePath.path,
    candidates,
    warning: candidates.length ? null : "No compatible active Sales reporting manager is available",
  };
};

const validateManagerForTransfer = async ({
  employeeContext,
  reportingManagerId,
  proposedPath,
  companyId,
  session = null,
  user,
  dependencies = {},
}) => {
  const deps = depsFor(dependencies);
  const validation = await deps.validateReportingManagerAssignment({
    companyId,
    employeeId: employeeContext.employee._id,
    employeeDesignationId: employeeContext.employee.designationId,
    departmentId: employeeContext.employee.departmentId,
    reportingManagerId,
    actorUser: user,
    employeeRole: getAccessRole(employeeContext.employee),
    allowEmptyForLegacy: false,
    session,
  });
  const managerContext = assertLifecycleEmployee(await findEmployeeContext({
    employeeId: validation.reportingManagerId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  }), { allowHead: true });
  if (managerContext.identity.hierarchyLevel <= employeeContext.identity.hierarchyLevel) {
    throw new ApiError(400, "Reporting manager must have a higher Sales hierarchy level");
  }
  const compatibility = await analyzeReportingCompatibility({
    employeeContext: contextWithManager(employeeContext, validation.reportingManagerId),
    proposedPath,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  if (compatibility.blocking) throw new ApiError(409, compatibility.message);
  return { validation, compatibility };
};

const buildSalesTransferPreview = async ({
  payload,
  user,
  session = null,
  dependencies = {},
}) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const reason = requireReason(payload.reason);
  const context = assertLifecycleEmployee(await findEmployeeContext({
    employeeId: payload.employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  }));
  const blockingConflicts = [];
  const warnings = [];
  if (context.employee.status !== "active") blockingConflicts.push("Only active Sales employees can be transferred");

  const currentAssignment = await findCurrentAssignment({
    employeeId: context.employee._id,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  const currentPath = currentAssignment ? await loadGeographyPath({
    geographyId: currentAssignment.geographyId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  }) : null;
  const targetGeographyId = payload.targetGeographyId || currentAssignment?.geographyId || null;
  if (!targetGeographyId) blockingConflicts.push("Select a target Geography for an unassigned employee");
  const proposedPath = targetGeographyId ? await loadGeographyPath({
    geographyId: targetGeographyId,
    companyId,
    activeOnly: true,
    dependencies: assignmentDependencies(deps),
    session,
  }) : null;
  if (proposedPath && proposedPath.target.type !== context.identity.expectedGeographyType) {
    blockingConflicts.push(`L${context.identity.hierarchyLevel} employees require ${context.identity.expectedGeographyType} Geography`);
  }

  const currentManagerId = managerIdFor(context.employee);
  const proposedManagerSupplied = Object.prototype.hasOwnProperty.call(payload, "proposedReportingManagerId") && Boolean(payload.proposedReportingManagerId);
  const desiredManagerId = proposedManagerSupplied ? payload.proposedReportingManagerId : currentManagerId;
  let currentManagerCompatibility = null;
  if (proposedPath) {
    currentManagerCompatibility = await analyzeReportingCompatibility({
      employeeContext: context,
      proposedPath,
      companyId,
      dependencies: assignmentDependencies(deps),
      session,
    });
  }
  const currentManagerCanRemain = Boolean(
    currentManagerId && currentManagerCompatibility && !currentManagerCompatibility.blocking
  );
  const managerDecision = currentManagerCanRemain
    ? "CURRENT_MANAGER_COMPATIBLE"
    : "MANAGER_CHANGE_REQUIRED";
  if (!currentManagerCanRemain && !proposedManagerSupplied) {
    blockingConflicts.push("Current reporting manager is incompatible; explicitly select a compatible Sales manager");
  }

  let proposedManagerValidation = null;
  if (proposedManagerSupplied && proposedPath) {
    try {
      proposedManagerValidation = await validateManagerForTransfer({
        employeeContext: context,
        reportingManagerId: desiredManagerId,
        proposedPath,
        companyId,
        session,
        user,
        dependencies: deps,
      });
    } catch (error) {
      if ([400, 404, 409].includes(error.statusCode)) blockingConflicts.push(error.message);
      else throw error;
    }
  }

  const geographyChanged = Boolean(proposedPath && !sameId(currentAssignment?.geographyId, proposedPath.target._id));
  const managerChanged = Boolean(desiredManagerId && !sameId(currentManagerId, desiredManagerId));
  if (!geographyChanged && !managerChanged) warnings.push("The requested transfer already matches the current organizational state");

  let assignmentPreview = null;
  if (payload.targetGeographyId && proposedPath) {
    assignmentPreview = await previewSalesGeographyAssignment({
      payload: {
        employeeId: context.employee._id,
        geographyId: proposedPath.target._id,
        reason,
        replaceCurrentHolder: payload.replaceCurrentHolder === true,
        reportingManagerIdOverride: desiredManagerId,
      },
      user,
      dependencies: assignmentDependencies(deps),
      session,
    });
    blockingConflicts.push(...assignmentPreview.blockingConflicts);
    warnings.push(...assignmentPreview.warnings);
  }

  const directReportImpact = await getDirectReportImpact({
    employeeContext: context,
    proposedManagerPath: proposedPath,
    companyId,
    session,
    dependencies: deps,
  });
  const invalidDirectReports = directReportImpact.filter((impact) => impact.blocking);
  if (invalidDirectReports.length) {
    blockingConflicts.push(`${invalidDirectReports.length} active direct report(s) would become Geography-incompatible`);
  }

  const type = geographyChanged && managerChanged
    ? LIFECYCLE_TYPES.GEOGRAPHY_AND_MANAGER_TRANSFER
    : geographyChanged
      ? LIFECYCLE_TYPES.GEOGRAPHY_TRANSFER
      : managerChanged
        ? LIFECYCLE_TYPES.REPORTING_MANAGER_CHANGE
        : "NO_CHANGE";

  return {
    canApply: blockingConflicts.length === 0,
    type,
    reason,
    employee: employeeSummary(context),
    current: {
      assignment: assignmentSummary(currentAssignment, currentPath?.path || null),
      reportingManagerId: currentManagerId,
      reportingManager: currentManagerCompatibility?.manager || null,
    },
    proposed: {
      geography: proposedPath?.path || null,
      geographyId: proposedPath?.target?._id || null,
      reportingManagerId: desiredManagerId || null,
      reportingManager: proposedManagerValidation?.compatibility?.manager || currentManagerCompatibility?.manager || null,
    },
    geographyChanged,
    managerChanged,
    managerDecision,
    currentManagerCompatibility,
    proposedManagerCompatibility: proposedManagerValidation?.compatibility || null,
    directReportImpact,
    vacancy: geographyChanged && currentAssignment ? {
      geographyId: currentAssignment.geographyId,
      geography: currentPath?.path || null,
      created: true,
    } : null,
    assignmentPreview,
    destinationConflict: assignmentPreview?.uniquenessConflict || null,
    warnings: [...new Set(warnings)],
    blockingConflicts: [...new Set(blockingConflicts)],
  };
};

const createLifecycleEvent = async ({ values, session, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const [event] = await deps.LifecycleEvent.create([values], { session });
  return event;
};

const applySalesTransfer = async ({ payload, user, req = null, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  let result;
  try {
    const preview = await buildSalesTransferPreview({ payload, user, session, dependencies: deps });
    if (!preview.canApply) throw new ApiError(409, "Sales transfer preview contains blocking conflicts", preview.blockingConflicts);
    if (preview.type === "NO_CHANGE") {
      await session.abortTransaction();
      return { applied: false, preview, assignment: preview.current.assignment, event: null };
    }
    const effectiveAt = deps.now();
    const operationId = deps.newOperationId();
    let assignmentResult = null;
    if (preview.geographyChanged) {
      assignmentResult = await applySalesGeographyAssignmentInSession({
        payload: {
          employeeId: payload.employeeId,
          geographyId: preview.proposed.geographyId,
          reason: preview.reason,
          replaceCurrentHolder: payload.replaceCurrentHolder === true,
          reportingManagerIdOverride: preview.proposed.reportingManagerId,
        },
        user,
        req,
        companyId,
        session,
        dependencies: assignmentDependencies(deps),
        preview: preview.assignmentPreview,
        effectiveAt,
        writeAudits: false,
      });
    }

    const context = await findEmployeeContext({
      employeeId: payload.employeeId,
      companyId,
      dependencies: assignmentDependencies(deps),
      session,
    });
    if (preview.managerChanged) {
      context.employee.reportingManagerId = preview.proposed.reportingManagerId;
      context.employee.managerId = preview.proposed.reportingManagerId;
      context.employee.updatedBy = user._id;
      await context.employee.save({ session, validateModifiedOnly: true });
    }

    const event = await createLifecycleEvent({
      session,
      dependencies: deps,
      values: {
        companyId,
        operationId,
        employeeId: context.employee._id,
        type: preview.type,
        oldGeographyAssignmentId: preview.geographyChanged
          ? assignmentResult?.currentAssignment?._id || preview.current.assignment?.id || null
          : null,
        newGeographyAssignmentId: preview.geographyChanged ? assignmentResult?.assignment?._id || null : null,
        oldGeographyId: preview.geographyChanged ? preview.current.assignment?.geographyId || null : null,
        newGeographyId: preview.geographyChanged ? preview.proposed.geographyId || null : null,
        oldGeographyPath: preview.geographyChanged ? preview.current.assignment?.employeeGeography || null : null,
        newGeographyPath: preview.geographyChanged ? preview.proposed.geography || null : null,
        oldReportingManagerId: preview.managerChanged ? preview.current.reportingManagerId || null : null,
        newReportingManagerId: preview.managerChanged ? preview.proposed.reportingManagerId || null : null,
        oldReportingManagerName: preview.managerChanged ? preview.current.reportingManager?.fullName || "" : "",
        newReportingManagerName: preview.managerChanged ? preview.proposed.reportingManager?.fullName || "" : "",
        changedBy: user._id,
        actorName: user.fullName || "",
        reason: preview.reason,
        effectiveAt,
        displacedEmployeeId: assignmentResult?.displacedAssignment?.employeeId || null,
        metadata: { managerDecision: preview.managerDecision },
      },
    });

    const auditAction = preview.type === LIFECYCLE_TYPES.REPORTING_MANAGER_CHANGE
      ? "SALES_REPORTING_MANAGER_CHANGED"
      : "SALES_EMPLOYEE_TRANSFERRED";
    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: auditAction,
      entityType: "SalesEmployeeLifecycleEvent",
      entityId: event._id,
      metadata: {
        operationId,
        employeeId: context.employee._id,
        transferType: preview.type,
        oldGeographyId: preview.current.assignment?.geographyId || null,
        newGeographyId: preview.proposed.geographyId || null,
        oldReportingManagerId: preview.current.reportingManagerId || null,
        newReportingManagerId: preview.proposed.reportingManagerId || null,
        reason: preview.reason,
      },
      req,
      session,
    });
    if (assignmentResult?.displacedAssignment) {
      await deps.writeAuditLog({
        companyId,
        actorId: user._id,
        action: "SALES_RESPONSIBLE_MANAGER_REPLACED",
        entityType: "SalesEmployeeLifecycleEvent",
        entityId: event._id,
        metadata: {
          operationId,
          replacementEmployeeId: context.employee._id,
          displacedEmployeeId: assignmentResult.displacedAssignment.employeeId,
          geographyId: preview.proposed.geographyId,
          reason: preview.reason,
        },
        req,
        session,
      });
    }
    await session.commitTransaction();
    result = {
      applied: true,
      preview,
      event,
      assignment: assignmentResult?.assignment
        ? assignmentSummary(assignmentResult.assignment, preview.proposed.geography)
        : preview.current.assignment,
    };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000) throw new ApiError(409, "A conflicting Sales transfer was applied concurrently");
    throw error;
  } finally {
    await session.endSession();
  }
  deps.invalidateOrgTreeCache(companyId);
  return result;
};

const buildEndAssignmentPreview = async ({ employeeId, reason, user, dependencies = {}, session = null }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const normalizedReason = requireReason(reason);
  const context = assertLifecycleEmployee(await findEmployeeContext({
    employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  }));
  const currentAssignment = await findCurrentAssignment({
    employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  if (!currentAssignment) throw new ApiError(404, "Current Sales Geography assignment not found");
  const currentPath = await loadGeographyPath({
    geographyId: currentAssignment.geographyId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  const directReportImpact = await getDirectReportImpact({
    employeeContext: context,
    proposedManagerPath: null,
    companyId,
    dependencies: deps,
    session,
  });
  return {
    canApply: true,
    type: LIFECYCLE_TYPES.END_ASSIGNMENT,
    reason: normalizedReason,
    employee: employeeSummary(context),
    currentAssignment: assignmentSummary(currentAssignment, currentPath.path),
    vacancy: { geographyId: currentAssignment.geographyId, geography: currentPath.path, created: true },
    directReportImpact,
    warnings: directReportImpact.length
      ? ["Direct reports remain in place; this manager will become geographically unassigned"]
      : [],
    blockingConflicts: [],
  };
};

const applyEndAssignment = async ({ employeeId, reason, user, req = null, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  let result;
  try {
    const preview = await buildEndAssignmentPreview({ employeeId, reason, user, dependencies: deps, session });
    const effectiveAt = deps.now();
    const operationId = deps.newOperationId();
    const ended = await endSalesGeographyAssignmentInSession({
      employeeId,
      reason: preview.reason,
      user,
      req,
      companyId,
      session,
      dependencies: assignmentDependencies(deps),
      effectiveAt,
      writeAudits: false,
    });
    const event = await createLifecycleEvent({
      session,
      dependencies: deps,
      values: {
        companyId,
        operationId,
        employeeId,
        type: LIFECYCLE_TYPES.END_ASSIGNMENT,
        oldGeographyAssignmentId: ended.assignment._id,
        oldGeographyId: ended.assignment.geographyId,
        oldGeographyPath: preview.currentAssignment.employeeGeography,
        changedBy: user._id,
        actorName: user.fullName || "",
        reason: preview.reason,
        effectiveAt,
      },
    });
    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: "SALES_EMPLOYEE_ASSIGNMENT_ENDED",
      entityType: "SalesEmployeeLifecycleEvent",
      entityId: event._id,
      metadata: { operationId, employeeId, geographyId: ended.assignment.geographyId, reason: preview.reason },
      req,
      session,
    });
    await session.commitTransaction();
    result = { applied: true, preview, event, assignment: assignmentSummary(ended.assignment, preview.currentAssignment.employeeGeography) };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
  deps.invalidateOrgTreeCache(companyId);
  return result;
};

const buildOffboardingPreview = async ({ employeeId, targetStatus, reason, user, dependencies = {}, session = null }) => {
  if (!canManageEmployeeRecords(user)) throw new ApiError(403, "Employee status authority is required for Sales offboarding");
  const companyId = user.companyId?._id || user.companyId;
  if (!companyId && getAccessRole(user) !== "super_admin") throw new ApiError(400, "Company is required for Sales offboarding");
  const normalizedStatus = targetStatus === "inactive" ? "disabled" : targetStatus;
  const deps = depsFor(dependencies);
  const context = await findEmployeeContext({
    employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  if (!isSalesDepartment(context.department)) {
    return { applicable: false, canApply: true, closesAssignment: false, targetStatus: normalizedStatus };
  }
  assertLifecycleEmployee(context);
  const normalizedReason = PERMANENT_OFFBOARDING_STATUSES.includes(normalizedStatus) ? requireReason(reason) : cleanReason(reason);
  const currentAssignment = await findCurrentAssignment({
    employeeId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  });
  const currentPath = currentAssignment ? await loadGeographyPath({
    geographyId: currentAssignment.geographyId,
    companyId,
    dependencies: assignmentDependencies(deps),
    session,
  }) : null;
  const directReportImpact = await getDirectReportImpact({
    employeeContext: context,
    proposedManagerPath: null,
    companyId,
    dependencies: deps,
    session,
  });
  const permanent = PERMANENT_OFFBOARDING_STATUSES.includes(normalizedStatus);
  const blockingConflicts = permanent && directReportImpact.length
    ? ["OFFBOARDING_BLOCKED_REQUIRES_REPORTING_RESOLUTION"]
    : [];
  return {
    applicable: true,
    canApply: blockingConflicts.length === 0,
    type: LIFECYCLE_TYPES.EMPLOYEE_OFFBOARDING,
    employee: employeeSummary(context),
    targetStatus: normalizedStatus,
    reason: normalizedReason,
    permanent,
    closesAssignment: permanent && Boolean(currentAssignment),
    currentAssignment: assignmentSummary(currentAssignment, currentPath?.path || null),
    vacancy: permanent && currentAssignment
      ? { geographyId: currentAssignment.geographyId, geography: currentPath.path, created: true }
      : null,
    directReportImpact,
    warnings: permanent ? [] : ["Temporary status does not close the current Sales Geography assignment"],
    blockingConflicts,
  };
};

const processSalesEmployeeOffboarding = async ({
  employee,
  previousStatus,
  targetStatus,
  reason,
  user,
  req = null,
  deletion = false,
  dependencies = {},
}) => {
  const normalizedStatus = deletion ? "deleted" : targetStatus === "inactive" ? "disabled" : targetStatus;
  if (!PERMANENT_OFFBOARDING_STATUSES.includes(normalizedStatus)) return { handled: false };
  if (!deletion && previousStatus === normalizedStatus) return { handled: true, applied: false };
  const deps = depsFor(dependencies);
  const companyId = employee.companyId || user.companyId;
  const statusActor = { ...(user.toObject?.() || user), companyId };
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const preview = await buildOffboardingPreview({
      employeeId: employee._id,
      targetStatus: normalizedStatus,
      reason,
      user: statusActor,
      dependencies: deps,
      session,
    });
    if (!preview.applicable) {
      await session.abortTransaction();
      return { handled: false, preview };
    }
    if (!preview.canApply) throw new ApiError(409, "Sales offboarding requires direct-report resolution", preview.blockingConflicts);
    const effectiveAt = deps.now();
    const operationId = deps.newOperationId();
    let endedAssignment = null;
    if (preview.closesAssignment) {
      const ended = await endSalesGeographyAssignmentInSession({
        employeeId: employee._id,
        reason: preview.reason,
        user: statusActor,
        req,
        companyId,
        session,
        dependencies: assignmentDependencies(deps),
        effectiveAt,
        writeAudits: false,
      });
      endedAssignment = ended.assignment;
    }
    if (deletion) employee.deletedAt = effectiveAt;
    else employee.status = normalizedStatus;
    employee.offboardedAt = effectiveAt;
    employee.offboardedBy = user._id;
    employee.offboardReason = preview.reason;
    employee.updatedBy = user._id;
    if (!deletion) {
      employee.statusHistory = employee.statusHistory || [];
      employee.statusHistory.push({
        status: normalizedStatus,
        changedAt: effectiveAt,
        changedBy: user._id,
        reason: preview.reason,
      });
    }
    await employee.save({ session, validateModifiedOnly: true });
    const event = await createLifecycleEvent({
      session,
      dependencies: deps,
      values: {
        companyId,
        operationId,
        employeeId: employee._id,
        type: LIFECYCLE_TYPES.EMPLOYEE_OFFBOARDING,
        oldGeographyAssignmentId: endedAssignment?._id || null,
        oldGeographyId: endedAssignment?.geographyId || null,
        oldGeographyPath: preview.currentAssignment?.employeeGeography || null,
        changedBy: user._id,
        actorName: user.fullName || "",
        reason: preview.reason,
        effectiveAt,
        targetStatus: normalizedStatus,
        metadata: { previousStatus, deleted: deletion },
      },
    });
    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: "SALES_EMPLOYEE_OFFBOARDING_PROCESSED",
      entityType: "SalesEmployeeLifecycleEvent",
      entityId: event._id,
      metadata: {
        operationId,
        employeeId: employee._id,
        previousStatus,
        targetStatus: normalizedStatus,
        geographyAssignmentEnded: Boolean(endedAssignment),
        reason: preview.reason,
      },
      req,
      session,
    });
    await session.commitTransaction();
    deps.invalidateOrgTreeCache(companyId);
    return { handled: true, preview, event, assignment: endedAssignment };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
};

const getSalesLifecycleHistory = async ({ employeeId, user, dependencies = {} }) => {
  const companyId = assertCanManageAssignments(user);
  const deps = depsFor(dependencies);
  const records = await deps.LifecycleEvent.find({ companyId, employeeId });
  records.sort((first, second) => new Date(second.effectiveAt) - new Date(first.effectiveAt));
  return records.map((record) => ({
    id: record._id,
    operationId: record.operationId,
    type: record.type,
    effectiveAt: record.effectiveAt,
    oldGeography: record.oldGeographyPath || null,
    newGeography: record.newGeographyPath || null,
    oldReportingManager: record.oldReportingManagerId ? {
      id: record.oldReportingManagerId,
      fullName: record.oldReportingManagerName || "Historical manager",
    } : null,
    newReportingManager: record.newReportingManagerId ? {
      id: record.newReportingManagerId,
      fullName: record.newReportingManagerName || "Historical manager",
    } : null,
    actor: { id: record.changedBy, fullName: record.actorName || "Historical actor" },
    reason: record.reason,
    targetStatus: record.targetStatus || null,
    displacedEmployeeId: record.displacedEmployeeId || null,
  }));
};

module.exports = {
  LIFECYCLE_TYPES,
  PERMANENT_OFFBOARDING_STATUSES,
  getDirectReportImpact,
  getCompatibleReportingManagers,
  buildSalesTransferPreview,
  applySalesTransfer,
  buildEndAssignmentPreview,
  applyEndAssignment,
  buildOffboardingPreview,
  processSalesEmployeeOffboarding,
  getSalesLifecycleHistory,
};
