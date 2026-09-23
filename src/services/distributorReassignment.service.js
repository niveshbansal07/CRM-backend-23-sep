const mongoose = require("mongoose");
const Account = require("../models/Account");
const User = require("../models/User");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const DistributorSalesAssignment = require("../models/DistributorSalesAssignment");
const DistributorReassignmentRequest = require("../models/DistributorReassignmentRequest");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const {
  REASSIGNMENT_ROLES,
  REQUEST_STATUSES,
  APPROVAL_LEVELS,
  BOUNDARY_TYPES,
  REASSIGNMENT_CODES,
} = require("../constants/distributorReassignment");
const {
  accountSummary,
  mappingSummary,
  loadDistributorAccount,
  validateArea,
  validatePrimaryFsd,
  buildSupervisoryOwnership,
  evaluateCurrentMapping,
  listDistributorMappingReadiness,
  employeeSummary,
} = require("./distributorSalesMapping.service");
const {
  findEmployeeContext,
  findCurrentAssignment,
} = require("./salesGeographyAssignment.service");
const { writeAuditLog } = require("./auditLog.service");

const DEFAULT_DEPS = {
  Account,
  User,
  Geography: SalesGeography,
  EmployeeAssignment: SalesEmployeeGeographyAssignment,
  DistributorMapping: DistributorSalesAssignment,
  ReassignmentRequest: DistributorReassignmentRequest,
  loadDistributorAccount,
  validateArea,
  validatePrimaryFsd,
  buildSupervisoryOwnership,
  evaluateCurrentMapping,
  listDistributorMappingReadiness,
  findEmployeeContext,
  findCurrentAssignment,
  writeAuditLog,
  startSession: () => mongoose.startSession(),
  now: () => new Date(),
  newOperationId: () => new mongoose.Types.ObjectId(),
};

const depsFor = (dependencies = {}) => ({ ...DEFAULT_DEPS, ...dependencies });
const toId = (value) => String(value?._id || value?.id || value || "");
const sameId = (left, right) => Boolean(toId(left)) && toId(left) === toId(right);
const cleanText = (value) => String(value || "").trim().replace(/\s+/g, " ");
const withSession = (query, session) => session && query?.session ? query.session(session) : query;
const withSort = (query, sort) => query?.sort ? query.sort(sort) : query;
const codedError = (status, code, message) => new ApiError(status, message, [code]);

const requireReason = (value, label = "Reassignment reason") => {
  const reason = cleanText(value);
  if (reason.length < 2) throw new ApiError(400, `${label} is required`);
  if (reason.length > 500) throw new ApiError(400, `${label} must be 500 characters or less`);
  return reason;
};

const assertReassignmentAccess = (user) => {
  const role = getAccessRole(user);
  if (!REASSIGNMENT_ROLES.includes(role)) {
    throw new ApiError(403, "Distributor reassignment is limited to Sales managers, Head of Sales, and platform administrators");
  }
  const companyId = user?.companyId?._id || user?.companyId;
  if (!companyId) throw new ApiError(400, "Company context is required");
  return { companyId, role };
};

const assignmentDeps = (deps) => ({
  User: deps.User,
  Geography: deps.Geography,
  Assignment: deps.EmployeeAssignment,
});

const loadCurrentMappingStrict = async ({ accountId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const mappings = await withSession(deps.DistributorMapping.find({
    companyId,
    distributorAccountId: accountId,
    isCurrent: true,
    deletedAt: null,
  }), session);
  if (!mappings?.length) {
    throw codedError(409, REASSIGNMENT_CODES.NO_CURRENT_MAPPING, "Distributor has no current mapping; complete Phase 4A initial mapping first");
  }
  if (mappings.length > 1) {
    throw codedError(409, REASSIGNMENT_CODES.DATA_INTEGRITY_CONFLICT, "Distributor has multiple current mappings");
  }
  return mappings[0];
};

const loadCurrentAreaAsm = async ({ areaId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const assignments = await withSession(deps.EmployeeAssignment.find({
    companyId,
    geographyId: areaId,
    geographyType: "AREA",
    hierarchyLevel: 2,
    isCurrent: true,
    isResponsibleManager: true,
    deletedAt: null,
  }), session);
  if ((assignments || []).length > 1) {
    throw codedError(409, REASSIGNMENT_CODES.DATA_INTEGRITY_CONFLICT, "Area has multiple current responsible ASMs");
  }
  const assignment = assignments?.[0] || null;
  if (!assignment) return { assignment: null, employee: null, context: null };
  try {
    const context = await deps.findEmployeeContext({
      employeeId: assignment.employeeId,
      companyId,
      session,
      dependencies: assignmentDeps(deps),
    });
    const valid = context?.employee?.status === "active" && !context.employee.deletedAt &&
      context.identity?.valid && Number(context.identity.hierarchyLevel) === 2;
    return valid ? { assignment, employee: context.employee, context } : { assignment, employee: null, context };
  } catch (error) {
    if ([404, 409].includes(error.statusCode)) return { assignment, employee: null, context: null };
    throw error;
  }
};

const geographyIdFromPath = (path, key) => path?.[key]?.id || path?.[key]?._id || path?.[key] || null;

const classifyTransferBoundary = ({ sourcePath, destinationPath }) => {
  const source = {
    area: geographyIdFromPath(sourcePath, "area"),
    branch: geographyIdFromPath(sourcePath, "branch"),
    region: geographyIdFromPath(sourcePath, "region"),
    zone: geographyIdFromPath(sourcePath, "zone"),
  };
  const destination = {
    area: geographyIdFromPath(destinationPath, "area"),
    branch: geographyIdFromPath(destinationPath, "branch"),
    region: geographyIdFromPath(destinationPath, "region"),
    zone: geographyIdFromPath(destinationPath, "zone"),
  };
  if (Object.values(source).some((value) => !value) || Object.values(destination).some((value) => !value)) {
    throw codedError(409, REASSIGNMENT_CODES.DATA_INTEGRITY_CONFLICT, "Source or destination Geography path is incomplete");
  }
  if (sameId(source.area, destination.area)) return BOUNDARY_TYPES.SAME_AREA;
  if (sameId(source.branch, destination.branch)) return BOUNDARY_TYPES.CROSS_AREA_SAME_BRANCH;
  if (sameId(source.region, destination.region)) return BOUNDARY_TYPES.CROSS_BRANCH_SAME_REGION;
  if (sameId(source.zone, destination.zone)) return BOUNDARY_TYPES.CROSS_REGION_SAME_ZONE;
  return BOUNDARY_TYPES.CROSS_ZONE;
};

const BOUNDARY_AUTHORITY = Object.freeze({
  [BOUNDARY_TYPES.SAME_AREA]: { level: 2, approvalLevel: APPROVAL_LEVELS.ASM, scopeKey: "area", geographyType: "AREA" },
  [BOUNDARY_TYPES.CROSS_AREA_SAME_BRANCH]: { level: 3, approvalLevel: APPROVAL_LEVELS.BRANCH_MANAGER, scopeKey: "branch", geographyType: "BRANCH" },
  [BOUNDARY_TYPES.CROSS_BRANCH_SAME_REGION]: { level: 4, approvalLevel: APPROVAL_LEVELS.RSM, scopeKey: "region", geographyType: "REGION" },
  [BOUNDARY_TYPES.CROSS_REGION_SAME_ZONE]: { level: 5, approvalLevel: APPROVAL_LEVELS.ZSM, scopeKey: "zone", geographyType: "ZONE" },
  [BOUNDARY_TYPES.CROSS_ZONE]: { level: 6, approvalLevel: APPROVAL_LEVELS.HEAD_OF_SALES, scopeKey: null, geographyType: null },
});

const loadCurrentResponsibleManager = async ({
  hierarchyLevel,
  geographyId,
  geographyType,
  companyId,
  session = null,
  dependencies = {},
}) => {
  const deps = depsFor(dependencies);
  if (Number(hierarchyLevel) === 6) {
    let query = deps.User.find({
      companyId,
      status: "active",
      deletedAt: null,
      $or: [{ role: "sales_head" }, { systemRole: "sales_head" }],
    });
    const candidates = await withSession(query, session);
    const valid = [];
    for (const employee of candidates || []) {
      try {
        const context = await deps.findEmployeeContext({
          employeeId: employee._id,
          companyId,
          session,
          dependencies: assignmentDeps(deps),
        });
        if (context.identity?.valid && Number(context.identity.hierarchyLevel) === 6) valid.push({ employee, context });
      } catch (error) {
        if (![404, 409].includes(error.statusCode)) throw error;
      }
    }
    if (valid.length > 1) throw codedError(409, REASSIGNMENT_CODES.DATA_INTEGRITY_CONFLICT, "Company has multiple active structured Heads of Sales");
    return valid[0] ? { assignment: null, ...valid[0] } : { assignment: null, employee: null, context: null };
  }
  const assignments = await withSession(deps.EmployeeAssignment.find({
    companyId,
    geographyId,
    geographyType,
    hierarchyLevel,
    isCurrent: true,
    isResponsibleManager: true,
    deletedAt: null,
  }), session);
  if ((assignments || []).length > 1) {
    throw codedError(409, REASSIGNMENT_CODES.DATA_INTEGRITY_CONFLICT, `Geography has multiple current responsible L${hierarchyLevel} managers`);
  }
  const assignment = assignments?.[0] || null;
  if (!assignment) return { assignment: null, employee: null, context: null };
  try {
    const context = await deps.findEmployeeContext({
      employeeId: assignment.employeeId,
      companyId,
      session,
      dependencies: assignmentDeps(deps),
    });
    const valid = context?.employee?.status === "active" && !context.employee.deletedAt &&
      context.identity?.valid && Number(context.identity.hierarchyLevel) === Number(hierarchyLevel);
    return valid ? { assignment, employee: context.employee, context } : { assignment, employee: null, context };
  } catch (error) {
    if ([404, 409].includes(error.statusCode)) return { assignment, employee: null, context: null };
    throw error;
  }
};

const resolveBoundaryAuthority = async ({
  boundaryType,
  sourcePath,
  companyId,
  session = null,
  dependencies = {},
}) => {
  const rule = BOUNDARY_AUTHORITY[boundaryType];
  if (!rule) throw codedError(409, REASSIGNMENT_CODES.DATA_INTEGRITY_CONFLICT, "Unsupported Distributor transfer boundary");
  const scopeGeographyId = rule.scopeKey ? geographyIdFromPath(sourcePath, rule.scopeKey) : null;
  const authority = await loadCurrentResponsibleManager({
    hierarchyLevel: rule.level,
    geographyId: scopeGeographyId,
    geographyType: rule.geographyType,
    companyId,
    session,
    dependencies,
  });
  return { ...rule, scopeGeographyId, ...authority };
};

const userSummary = (user) => user ? ({
  id: user._id || user.id,
  fullName: user.fullName || "",
  employeeId: user.employeeId || "",
  status: user.status || "",
}) : null;

const assertRequesterAuthority = async ({ user, areaId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const role = getAccessRole(user);
  if (["super_admin", "company_admin", "sales_head"].includes(role)) return role;
  const asm = await loadCurrentAreaAsm({ areaId, companyId, session, dependencies: deps });
  if (!asm.employee || !sameId(asm.employee._id, user._id)) {
    throw new ApiError(403, "Only the current responsible Area ASM may request this Distributor reassignment");
  }
  return role;
};

const intentContext = async ({
  payload,
  user,
  session = null,
  dependencies = {},
  checkOpenRequest = true,
}) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const reason = requireReason(payload?.reason);
  const account = await deps.loadDistributorAccount({
    accountId: payload.distributorAccountId,
    companyId,
    session,
    dependencies: deps,
  });
  const current = await loadCurrentMappingStrict({
    accountId: account._id,
    companyId,
    session,
    dependencies: deps,
  });
  await assertRequesterAuthority({ user, areaId: current.geographyId, companyId, session, dependencies: deps });

  const blockers = [];
  if (account.status !== "active") blockers.push(REASSIGNMENT_CODES.DISTRIBUTOR_INACTIVE);
  if (!sameId(account.assignedTo, current.primaryFsdId)) blockers.push(REASSIGNMENT_CODES.ASSIGNEE_MIRROR_CONFLICT);
  if (sameId(current.primaryFsdId, payload.newPrimaryFsdId)) blockers.push(REASSIGNMENT_CODES.SAME_FSD_NOT_REASSIGNMENT);

  const proposedAssignment = await deps.findCurrentAssignment({
    employeeId: payload.newPrimaryFsdId,
    companyId,
    session,
    dependencies: assignmentDeps(deps),
  });
  if (proposedAssignment && !sameId(proposedAssignment.geographyId, current.geographyId)) {
    throw codedError(
      409,
      REASSIGNMENT_CODES.CROSS_AREA_REASSIGNMENT_NOT_SUPPORTED_IN_PHASE_5A,
      "New Primary FSD must be assigned to the Distributor's existing Area"
    );
  }

  const [area, primary] = await Promise.all([
    deps.validateArea({ areaId: current.geographyId, companyId, session, dependencies: deps }),
    deps.validatePrimaryFsd({
      fsdId: payload.newPrimaryFsdId,
      areaId: current.geographyId,
      companyId,
      session,
      dependencies: deps,
    }),
  ]);
  const [supervision, asm, health] = await Promise.all([
    deps.buildSupervisoryOwnership({
      path: area.path,
      primaryFsdContext: primary.context,
      companyId,
      session,
      dependencies: deps,
    }),
    loadCurrentAreaAsm({ areaId: current.geographyId, companyId, session, dependencies: deps }),
    deps.evaluateCurrentMapping({ account, mapping: current, companyId, dependencies: deps }),
  ]);

  let approvalLevel = APPROVAL_LEVELS.ASM;
  const warnings = [...(supervision.warnings || [])];
  if (!asm.employee) {
    approvalLevel = APPROVAL_LEVELS.HEAD_OF_SALES;
    warnings.push(REASSIGNMENT_CODES.ASM_VACANT_HEAD_APPROVAL_REQUIRED);
  } else if (sameId(asm.employee._id, user._id)) {
    approvalLevel = APPROVAL_LEVELS.HEAD_OF_SALES;
    warnings.push(REASSIGNMENT_CODES.MAKER_CHECKER_HEAD_APPROVAL_REQUIRED);
  }

  let openRequest = null;
  if (checkOpenRequest) {
    openRequest = await withSession(deps.ReassignmentRequest.findOne({
      companyId,
      distributorAccountId: account._id,
      isOpen: true,
      deletedAt: null,
    }), session);
    if (openRequest) blockers.push(REASSIGNMENT_CODES.ACTIVE_REQUEST_EXISTS);
  }

  return {
    companyId,
    reason,
    account,
    current,
    area,
    primary,
    supervision,
    asm,
    health,
    approvalLevel,
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
    openRequest,
  };
};

const buildSameAreaPreview = async ({ payload, user, session = null, dependencies = {} }) => {
  const context = await intentContext({ payload, user, session, dependencies, checkOpenRequest: true });
  const oldFsd = await depsFor(dependencies).User.findOne({
    _id: context.current.primaryFsdId,
    companyId: context.companyId,
  });
  return {
    canSubmit: context.blockers.length === 0,
    operationType: "SAME_AREA_FSD_REASSIGNMENT",
    distributor: accountSummary(context.account),
    area: context.area.path,
    currentMapping: mappingSummary(context.current),
    oldPrimaryFsd: userSummary(oldFsd),
    newPrimaryFsd: employeeSummary(context.primary.context),
    newPrimaryFsdAssignment: {
      id: context.primary.assignment._id,
      geographyId: context.primary.assignment.geographyId,
      geographyType: context.primary.assignment.geographyType,
    },
    accountMirror: {
      assignedTo: context.account.assignedTo?._id || context.account.assignedTo || null,
      expectedPrimaryFsdId: context.current.primaryFsdId,
      consistent: sameId(context.account.assignedTo, context.current.primaryFsdId),
    },
    mappingHealth: context.health,
    approval: {
      level: context.approvalLevel,
      responsibleAsm: userSummary(context.asm.employee),
      requestedApproverId: context.approvalLevel === APPROVAL_LEVELS.ASM ? context.asm.employee?._id : null,
    },
    supervisoryOwnership: context.supervision.chain,
    reason: context.reason,
    warnings: context.warnings,
    blockers: context.blockers,
  };
};

const assertCrossTransferRequesterAuthority = ({ user, authority }) => {
  const role = getAccessRole(user);
  if (["super_admin", "company_admin", "sales_head"].includes(role)) return role;
  if (!authority.employee || !sameId(authority.employee._id, user._id)) {
    throw new ApiError(403, `Only the current responsible ${authority.approvalLevel} may request this cross-Geography transfer`);
  }
  return role;
};

const impactForBoundary = (boundaryType) => {
  const changedByBoundary = {
    [BOUNDARY_TYPES.CROSS_AREA_SAME_BRANCH]: ["AREA", "ASM", "PRIMARY_FSD"],
    [BOUNDARY_TYPES.CROSS_BRANCH_SAME_REGION]: ["AREA", "ASM", "BRANCH", "BRANCH_MANAGER", "PRIMARY_FSD"],
    [BOUNDARY_TYPES.CROSS_REGION_SAME_ZONE]: ["AREA", "ASM", "BRANCH", "BRANCH_MANAGER", "REGION", "RSM", "PRIMARY_FSD"],
    [BOUNDARY_TYPES.CROSS_ZONE]: ["AREA", "ASM", "BRANCH", "BRANCH_MANAGER", "REGION", "RSM", "ZONE", "ZSM", "PRIMARY_FSD"],
  };
  const all = ["AREA", "ASM", "BRANCH", "BRANCH_MANAGER", "REGION", "RSM", "ZONE", "ZSM", "PRIMARY_FSD", "HEAD_OF_SALES"];
  const changed = changedByBoundary[boundaryType] || [];
  return { changed, unchanged: all.filter((item) => !changed.includes(item)) };
};

const crossTransferContext = async ({
  payload,
  user,
  session = null,
  dependencies = {},
  checkOpenRequest = true,
}) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const reason = requireReason(payload?.reason, "Transfer reason");
  if (!payload?.destinationAreaId) {
    throw codedError(400, REASSIGNMENT_CODES.DESTINATION_AREA_REQUIRED, "Destination Area is required for cross-Geography transfer");
  }
  const account = await deps.loadDistributorAccount({
    accountId: payload.distributorAccountId,
    companyId,
    session,
    dependencies: deps,
  });
  const current = await loadCurrentMappingStrict({ accountId: account._id, companyId, session, dependencies: deps });
  if (sameId(current.geographyId, payload.destinationAreaId)) {
    return { sameArea: true, context: await intentContext({ payload, user, session, dependencies: deps, checkOpenRequest }) };
  }

  const blockers = [];
  if (account.status !== "active") blockers.push(REASSIGNMENT_CODES.DISTRIBUTOR_INACTIVE);
  if (!sameId(account.assignedTo, current.primaryFsdId)) blockers.push(REASSIGNMENT_CODES.ASSIGNEE_MIRROR_CONFLICT);

  const [sourceArea, destinationArea] = await Promise.all([
    deps.validateArea({ areaId: current.geographyId, companyId, session, dependencies: deps }),
    deps.validateArea({ areaId: payload.destinationAreaId, companyId, session, dependencies: deps }),
  ]);
  const boundaryType = classifyTransferBoundary({ sourcePath: sourceArea.path, destinationPath: destinationArea.path });
  if (boundaryType === BOUNDARY_TYPES.SAME_AREA) {
    throw codedError(409, REASSIGNMENT_CODES.DESTINATION_AREA_MUST_DIFFER, "Phase 5B destination must differ from the current Area");
  }

  const proposedAssignment = await deps.findCurrentAssignment({
    employeeId: payload.newPrimaryFsdId,
    companyId,
    session,
    dependencies: assignmentDeps(deps),
  });
  if (proposedAssignment && !sameId(proposedAssignment.geographyId, destinationArea.target._id)) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_NEW_FSD_GEOGRAPHY_CHANGED, "New Primary FSD must be assigned to the destination Area");
  }
  const primary = await deps.validatePrimaryFsd({
    fsdId: payload.newPrimaryFsdId,
    areaId: destinationArea.target._id,
    companyId,
    session,
    dependencies: deps,
  });
  const [oldSupervision, newSupervision, authority, health] = await Promise.all([
    deps.buildSupervisoryOwnership({
      path: sourceArea.path,
      primaryFsdContext: null,
      companyId,
      session,
      dependencies: deps,
    }),
    deps.buildSupervisoryOwnership({
      path: destinationArea.path,
      primaryFsdContext: primary.context,
      companyId,
      session,
      dependencies: deps,
    }),
    resolveBoundaryAuthority({ boundaryType, sourcePath: sourceArea.path, companyId, session, dependencies: deps }),
    deps.evaluateCurrentMapping({ account, mapping: current, companyId, dependencies: deps }),
  ]);
  assertCrossTransferRequesterAuthority({ user, authority });

  let approvalLevel = authority.approvalLevel;
  const warnings = [...(newSupervision.warnings || [])];
  if (!authority.employee) {
    approvalLevel = APPROVAL_LEVELS.HEAD_OF_SALES;
    warnings.push(REASSIGNMENT_CODES.REQUIRED_APPROVER_VACANT_HEAD_APPROVAL_REQUIRED);
  } else if (sameId(authority.employee._id, user._id)) {
    approvalLevel = APPROVAL_LEVELS.HEAD_OF_SALES;
    warnings.push(REASSIGNMENT_CODES.MAKER_CHECKER_HEAD_APPROVAL_REQUIRED);
  }

  let openRequest = null;
  if (checkOpenRequest) {
    openRequest = await withSession(deps.ReassignmentRequest.findOne({
      companyId,
      distributorAccountId: account._id,
      isOpen: true,
      deletedAt: null,
    }), session);
    if (openRequest) blockers.push(REASSIGNMENT_CODES.ACTIVE_REQUEST_EXISTS);
  }
  return {
    sameArea: false,
    companyId,
    reason,
    account,
    current,
    sourceArea,
    destinationArea,
    boundaryType,
    primary,
    oldSupervision,
    newSupervision,
    authority,
    health,
    approvalLevel,
    impact: impactForBoundary(boundaryType),
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
    openRequest,
  };
};

const buildCrossTransferPreview = async ({ payload, user, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const context = await crossTransferContext({ payload, user, session, dependencies: deps, checkOpenRequest: true });
  if (context.sameArea) return buildSameAreaPreview({ payload, user, session, dependencies: deps });
  const oldFsd = await deps.User.findOne({ _id: context.current.primaryFsdId, companyId: context.companyId });
  return {
    canSubmit: context.blockers.length === 0,
    operationType: "CROSS_GEOGRAPHY_TRANSFER",
    requestType: "CROSS_GEOGRAPHY_TRANSFER",
    boundaryType: context.boundaryType,
    distributor: accountSummary(context.account),
    current: {
      geography: context.sourceArea.path,
      primaryFsd: userSummary(oldFsd),
      supervisoryOwnership: context.oldSupervision.chain,
    },
    destination: {
      geography: context.destinationArea.path,
      primaryFsd: employeeSummary(context.primary.context),
      primaryFsdAssignment: {
        id: context.primary.assignment._id,
        geographyId: context.primary.assignment.geographyId,
        geographyType: context.primary.assignment.geographyType,
      },
      supervisoryOwnership: context.newSupervision.chain,
    },
    currentMapping: mappingSummary(context.current),
    accountMirror: {
      assignedTo: context.account.assignedTo?._id || context.account.assignedTo || null,
      expectedPrimaryFsdId: context.current.primaryFsdId,
      consistent: sameId(context.account.assignedTo, context.current.primaryFsdId),
    },
    mappingHealth: context.health,
    approval: {
      requiredLevel: context.authority.approvalLevel,
      effectiveLevel: context.approvalLevel,
      hierarchyLevel: context.authority.level,
      scopeGeographyId: context.authority.scopeGeographyId,
      responsibleManager: userSummary(context.authority.employee),
      requestedApproverId: context.approvalLevel === context.authority.approvalLevel
        ? context.authority.employee?._id || null
        : null,
    },
    impact: context.impact,
    reason: context.reason,
    warnings: context.warnings,
    blockers: context.blockers,
  };
};

const buildReassignmentPreview = (input) => input.payload?.destinationAreaId
  ? buildCrossTransferPreview(input)
  : buildSameAreaPreview(input);

const requestSummary = (request, names = new Map(), accounts = new Map(), geographies = new Map()) => ({
  id: request._id,
  operationId: request.operationId,
  distributorAccountId: request.distributorAccountId,
  currentAssignmentId: request.currentAssignmentId,
  geographyId: request.geographyId,
  destinationGeographyId: request.destinationGeographyId || request.geographyId,
  boundaryType: request.boundaryType || BOUNDARY_TYPES.SAME_AREA,
  requestType: request.requestType,
  oldPrimaryFsdId: request.oldPrimaryFsdId,
  newPrimaryFsdId: request.newPrimaryFsdId,
  requestedBy: request.requestedBy,
  reason: request.reason,
  warnings: request.warnings || [],
  status: request.status,
  approvalLevel: request.approvalLevel,
  requiredApprovalLevel: request.requiredApprovalLevel || APPROVAL_LEVELS.ASM,
  approvalScopeGeographyId: request.approvalScopeGeographyId || request.geographyId,
  requestedApproverId: request.requestedApproverId,
  reviewedBy: request.reviewedBy,
  decisionReason: request.decisionReason,
  overrideUsed: request.overrideUsed === true,
  overrideReason: request.overrideReason || "",
  reviewedAt: request.reviewedAt,
  cancelledAt: request.cancelledAt,
  appliedAt: request.appliedAt,
  appliedAssignmentId: request.appliedAssignmentId,
  requestedAt: request.createdAt,
  oldPrimaryFsd: names.get(toId(request.oldPrimaryFsdId)) || null,
  newPrimaryFsd: names.get(toId(request.newPrimaryFsdId)) || null,
  requester: names.get(toId(request.requestedBy)) || null,
  reviewer: names.get(toId(request.reviewedBy)) || null,
  distributor: accounts.get(toId(request.distributorAccountId)) || null,
  geography: geographies.get(toId(request.geographyId)) || null,
  sourceGeography: geographies.get(toId(request.geographyId)) || null,
  destinationGeography: geographies.get(toId(request.destinationGeographyId || request.geographyId)) || null,
  accountMirror: accounts.has(toId(request.distributorAccountId)) ? {
    assignedTo: accounts.get(toId(request.distributorAccountId))?.assignedTo?.id || null,
    expectedPrimaryFsdId: request.status === REQUEST_STATUSES.APPLIED
      ? request.newPrimaryFsdId
      : request.oldPrimaryFsdId,
    consistent: sameId(
      accounts.get(toId(request.distributorAccountId))?.assignedTo?.id,
      request.status === REQUEST_STATUSES.APPLIED ? request.newPrimaryFsdId : request.oldPrimaryFsdId
    ),
  } : null,
});

const createSameAreaRequest = async ({ payload, user, req = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const context = await intentContext({ payload, user, session, dependencies: deps, checkOpenRequest: true });
    if (context.blockers.length) {
      throw new ApiError(409, "Distributor reassignment request contains blocking conflicts", context.blockers);
    }
    const operationId = deps.newOperationId();
    const [request] = await deps.ReassignmentRequest.create([{
      companyId: context.companyId,
      distributorAccountId: context.account._id,
      currentAssignmentId: context.current._id,
      oldPrimaryFsdId: context.current.primaryFsdId,
      newPrimaryFsdId: context.primary.context.employee._id,
      geographyId: context.current.geographyId,
      destinationGeographyId: context.current.geographyId,
      boundaryType: BOUNDARY_TYPES.SAME_AREA,
      requiredApprovalLevel: APPROVAL_LEVELS.ASM,
      approvalScopeGeographyId: context.current.geographyId,
      requestedBy: user._id,
      reason: context.reason,
      warnings: context.warnings,
      status: REQUEST_STATUSES.PENDING,
      isOpen: true,
      approvalLevel: context.approvalLevel,
      requestedApproverId: context.approvalLevel === APPROVAL_LEVELS.ASM ? context.asm.employee._id : null,
      operationId,
    }], { session });
    await deps.writeAuditLog({
      companyId: context.companyId,
      actorId: user._id,
      action: "DISTRIBUTOR_REASSIGNMENT_REQUESTED",
      entityType: "DistributorReassignmentRequest",
      entityId: request._id,
      metadata: {
        operationId,
        distributorAccountId: context.account._id,
        currentAssignmentId: context.current._id,
        oldPrimaryFsdId: context.current.primaryFsdId,
        newPrimaryFsdId: context.primary.context.employee._id,
        geographyId: context.current.geographyId,
        approvalLevel: context.approvalLevel,
      },
      req,
      session,
    });
    await session.commitTransaction();
    return { created: true, request: requestSummary(request), warnings: context.warnings };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000) {
      throw codedError(409, REASSIGNMENT_CODES.ACTIVE_REQUEST_EXISTS, "An active reassignment request already exists for this Distributor");
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const createCrossTransferRequest = async ({ payload, user, req = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const context = await crossTransferContext({ payload, user, session, dependencies: deps, checkOpenRequest: true });
    if (context.sameArea) {
      throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_BOUNDARY_CHANGED, "Transfer became same-Area while request creation was starting; retry as Phase 5A reassignment");
    }
    if (context.blockers.length) {
      throw new ApiError(409, "Distributor transfer request contains blocking conflicts", context.blockers);
    }
    const operationId = deps.newOperationId();
    const sourcePath = context.sourceArea.path;
    const destinationPath = context.destinationArea.path;
    const fallbackHeadId = context.newSupervision.chain?.headOfSales?.id || null;
    const requestedApproverId = context.approvalLevel === context.authority.approvalLevel
      ? context.authority.employee?._id || null
      : fallbackHeadId;
    const [request] = await deps.ReassignmentRequest.create([{
      companyId: context.companyId,
      distributorAccountId: context.account._id,
      currentAssignmentId: context.current._id,
      oldPrimaryFsdId: context.current.primaryFsdId,
      newPrimaryFsdId: context.primary.context.employee._id,
      geographyId: context.current.geographyId,
      destinationGeographyId: context.destinationArea.target._id,
      boundaryType: context.boundaryType,
      requestType: "CROSS_GEOGRAPHY_TRANSFER",
      requiredApprovalLevel: context.authority.approvalLevel,
      approvalScopeGeographyId: context.authority.scopeGeographyId,
      sourceBranchId: geographyIdFromPath(sourcePath, "branch"),
      sourceRegionId: geographyIdFromPath(sourcePath, "region"),
      sourceZoneId: geographyIdFromPath(sourcePath, "zone"),
      destinationBranchId: geographyIdFromPath(destinationPath, "branch"),
      destinationRegionId: geographyIdFromPath(destinationPath, "region"),
      destinationZoneId: geographyIdFromPath(destinationPath, "zone"),
      requestedBy: user._id,
      reason: context.reason,
      warnings: context.warnings,
      status: REQUEST_STATUSES.PENDING,
      isOpen: true,
      approvalLevel: context.approvalLevel,
      requestedApproverId,
      operationId,
    }], { session });
    await deps.writeAuditLog({
      companyId: context.companyId,
      actorId: user._id,
      action: "DISTRIBUTOR_TRANSFER_REQUESTED",
      entityType: "DistributorReassignmentRequest",
      entityId: request._id,
      metadata: {
        operationId,
        distributorAccountId: context.account._id,
        currentAssignmentId: context.current._id,
        sourceGeographyId: context.current.geographyId,
        destinationGeographyId: context.destinationArea.target._id,
        oldPrimaryFsdId: context.current.primaryFsdId,
        newPrimaryFsdId: context.primary.context.employee._id,
        boundaryType: context.boundaryType,
        requiredApprovalLevel: context.authority.approvalLevel,
        effectiveApprovalLevel: context.approvalLevel,
        requesterId: user._id,
        reason: context.reason,
      },
      req,
      session,
    });
    await session.commitTransaction();
    return { created: true, request: requestSummary(request), warnings: context.warnings };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000) {
      throw codedError(409, REASSIGNMENT_CODES.ACTIVE_REQUEST_EXISTS, "An active reassignment request already exists for this Distributor");
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const createReassignmentRequest = async (input) => {
  if (!input.payload?.destinationAreaId) return createSameAreaRequest(input);
  const deps = depsFor(input.dependencies);
  const { companyId } = assertReassignmentAccess(input.user);
  const current = await loadCurrentMappingStrict({
    accountId: input.payload.distributorAccountId,
    companyId,
    dependencies: deps,
  });
  if (sameId(current.geographyId, input.payload.destinationAreaId)) {
    return createSameAreaRequest({
      ...input,
      payload: { ...input.payload, destinationAreaId: undefined },
    });
  }
  return createCrossTransferRequest(input);
};

const loadRequest = async ({ requestId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const request = await withSession(deps.ReassignmentRequest.findOne({
    _id: requestId,
    companyId,
    deletedAt: null,
  }), session);
  if (!request) throw new ApiError(404, "Distributor reassignment request not found");
  return request;
};

const assertSameAreaApprovalAuthority = async ({ request, user, context, payload, dependencies = {} }) => {
  const role = getAccessRole(user);
  if (["super_admin", "company_admin"].includes(role)) return APPROVAL_LEVELS.PLATFORM_ADMIN;
  if (role === "sales_manager") {
    if (!context.asm.employee || !sameId(context.asm.employee._id, user._id)) {
      throw codedError(403, REASSIGNMENT_CODES.CURRENT_AREA_ASM_APPROVAL_REQUIRED, "Only the current responsible Area ASM may standard-approve");
    }
    if (sameId(request.requestedBy, user._id) || request.approvalLevel !== APPROVAL_LEVELS.ASM) {
      throw new ApiError(403, "Maker/checker separation requires Head of Sales approval");
    }
    return APPROVAL_LEVELS.ASM;
  }
  if (role === "sales_head") {
    const fallback = request.approvalLevel === APPROVAL_LEVELS.HEAD_OF_SALES || !context.asm.employee;
    const override = payload?.override === true;
    if (!fallback && !override) {
      throw new ApiError(403, "Current Area ASM approval is required unless Head of Sales uses a controlled override");
    }
    if (override || sameId(request.requestedBy, user._id)) {
      requireReason(payload?.overrideReason, "Head of Sales override reason");
    }
    return APPROVAL_LEVELS.HEAD_OF_SALES;
  }
  throw new ApiError(403, "Approval authority is not available");
};

const revalidateSameAreaRequest = async ({ request, user, session, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const account = await deps.loadDistributorAccount({
    accountId: request.distributorAccountId,
    companyId: request.companyId,
    session,
    dependencies: deps,
  });
  const current = await loadCurrentMappingStrict({
    accountId: request.distributorAccountId,
    companyId: request.companyId,
    session,
    dependencies: deps,
  });
  if (!sameId(current._id, request.currentAssignmentId) ||
      !sameId(current.primaryFsdId, request.oldPrimaryFsdId) ||
      !sameId(current.geographyId, request.geographyId)) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_CURRENT_MAPPING_CHANGED, "Current Distributor mapping changed while the request was pending");
  }
  if (account.status !== "active") {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE, "Distributor is no longer active");
  }
  if (!sameId(account.assignedTo, current.primaryFsdId)) {
    throw codedError(409, REASSIGNMENT_CODES.ASSIGNEE_MIRROR_CONFLICT, "Account.assignedTo no longer matches the current Primary FSD");
  }
  const proposedAssignment = await deps.findCurrentAssignment({
    employeeId: request.newPrimaryFsdId,
    companyId: request.companyId,
    session,
    dependencies: assignmentDeps(deps),
  });
  if (proposedAssignment && !sameId(proposedAssignment.geographyId, request.geographyId)) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE, "Proposed Primary FSD moved outside the Distributor Area");
  }
  let primary;
  try {
    primary = await deps.validatePrimaryFsd({
      fsdId: request.newPrimaryFsdId,
      areaId: request.geographyId,
      companyId: request.companyId,
      session,
      dependencies: deps,
    });
  } catch (error) {
    if ([400, 404, 409].includes(error.statusCode)) {
      throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE, `Proposed Primary FSD is no longer eligible: ${error.message}`);
    }
    throw error;
  }
  const area = await deps.validateArea({
    areaId: request.geographyId,
    companyId: request.companyId,
    session,
    dependencies: deps,
  });
  const [asm, supervision] = await Promise.all([
    loadCurrentAreaAsm({ areaId: request.geographyId, companyId: request.companyId, session, dependencies: deps }),
    deps.buildSupervisoryOwnership({
      path: area.path,
      primaryFsdContext: primary.context,
      companyId: request.companyId,
      session,
      dependencies: deps,
    }),
  ]);
  return { account, current, primary, area, asm, supervision, targetGeographyId: request.geographyId };
};

const assertCrossTransferApprovalAuthority = async ({ request, user, context, payload }) => {
  const role = getAccessRole(user);
  if (["super_admin", "company_admin"].includes(role)) return APPROVAL_LEVELS.PLATFORM_ADMIN;
  if (role === "sales_manager") {
    if (!context.authority.employee || !sameId(context.authority.employee._id, user._id)) {
      throw codedError(403, REASSIGNMENT_CODES.CURRENT_BOUNDARY_MANAGER_APPROVAL_REQUIRED, `Only the current responsible ${context.authority.approvalLevel} may approve this boundary`);
    }
    if (request.approvalLevel !== context.authority.approvalLevel || sameId(request.requestedBy, user._id)) {
      throw new ApiError(403, "Maker/checker or vacancy fallback requires Head of Sales approval");
    }
    return context.authority.approvalLevel;
  }
  if (role === "sales_head") {
    const normalCrossZone = context.boundaryType === BOUNDARY_TYPES.CROSS_ZONE &&
      context.authority.approvalLevel === APPROVAL_LEVELS.HEAD_OF_SALES;
    const fallback = request.approvalLevel === APPROVAL_LEVELS.HEAD_OF_SALES || !context.authority.employee;
    const fallbackOrMakerChecker = request.approvalLevel === APPROVAL_LEVELS.HEAD_OF_SALES &&
      request.requiredApprovalLevel !== APPROVAL_LEVELS.HEAD_OF_SALES;
    const vacantNow = !context.authority.employee &&
      context.authority.approvalLevel !== APPROVAL_LEVELS.HEAD_OF_SALES;
    const override = payload?.override === true;
    if (!normalCrossZone && !fallback && !override) {
      throw new ApiError(403, `Current ${context.authority.approvalLevel} approval is required unless Head of Sales uses a controlled override`);
    }
    if (override || fallbackOrMakerChecker || vacantNow || sameId(request.requestedBy, user._id)) {
      requireReason(payload?.overrideReason, "Head of Sales override reason");
    }
    return APPROVAL_LEVELS.HEAD_OF_SALES;
  }
  throw new ApiError(403, "Cross-Geography approval authority is not available");
};

const revalidateCrossTransferRequest = async ({ request, session, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const account = await deps.loadDistributorAccount({
    accountId: request.distributorAccountId,
    companyId: request.companyId,
    session,
    dependencies: deps,
  });
  const current = await loadCurrentMappingStrict({
    accountId: request.distributorAccountId,
    companyId: request.companyId,
    session,
    dependencies: deps,
  });
  if (!sameId(current._id, request.currentAssignmentId) ||
      !sameId(current.primaryFsdId, request.oldPrimaryFsdId) ||
      !sameId(current.geographyId, request.geographyId)) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_CURRENT_MAPPING_CHANGED, "Current Distributor mapping changed while the transfer was pending");
  }
  if (account.status !== "active") throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE, "Distributor is no longer active");
  if (!sameId(account.assignedTo, current.primaryFsdId)) {
    throw codedError(409, REASSIGNMENT_CODES.ASSIGNEE_MIRROR_CONFLICT, "Account.assignedTo no longer matches the current Primary FSD");
  }
  const destinationGeographyId = request.destinationGeographyId;
  if (!destinationGeographyId || sameId(destinationGeographyId, request.geographyId)) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_BOUNDARY_CHANGED, "Cross-Geography request no longer has a distinct destination Area");
  }
  let sourceArea;
  let destinationArea;
  try {
    [sourceArea, destinationArea] = await Promise.all([
      deps.validateArea({ areaId: request.geographyId, companyId: request.companyId, session, dependencies: deps }),
      deps.validateArea({ areaId: destinationGeographyId, companyId: request.companyId, session, dependencies: deps }),
    ]);
  } catch (error) {
    if ([400, 404, 409].includes(error.statusCode)) {
      throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE, `Source or destination Geography is no longer valid: ${error.message}`);
    }
    throw error;
  }
  const boundaryType = classifyTransferBoundary({ sourcePath: sourceArea.path, destinationPath: destinationArea.path });
  const parentSnapshotsMatch = [
    [request.sourceBranchId, geographyIdFromPath(sourceArea.path, "branch")],
    [request.sourceRegionId, geographyIdFromPath(sourceArea.path, "region")],
    [request.sourceZoneId, geographyIdFromPath(sourceArea.path, "zone")],
    [request.destinationBranchId, geographyIdFromPath(destinationArea.path, "branch")],
    [request.destinationRegionId, geographyIdFromPath(destinationArea.path, "region")],
    [request.destinationZoneId, geographyIdFromPath(destinationArea.path, "zone")],
  ].every(([stored, currentId]) => !stored || sameId(stored, currentId));
  if (boundaryType !== request.boundaryType || !parentSnapshotsMatch) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_BOUNDARY_CHANGED, "Transfer boundary or Geography path changed while pending");
  }
  const proposedAssignment = await deps.findCurrentAssignment({
    employeeId: request.newPrimaryFsdId,
    companyId: request.companyId,
    session,
    dependencies: assignmentDeps(deps),
  });
  if (!proposedAssignment || !sameId(proposedAssignment.geographyId, destinationGeographyId)) {
    throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_NEW_FSD_GEOGRAPHY_CHANGED, "Proposed Primary FSD is no longer assigned to the destination Area");
  }
  let primary;
  try {
    primary = await deps.validatePrimaryFsd({
      fsdId: request.newPrimaryFsdId,
      areaId: destinationGeographyId,
      companyId: request.companyId,
      session,
      dependencies: deps,
    });
  } catch (error) {
    if ([400, 404, 409].includes(error.statusCode)) {
      throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE, `Destination Primary FSD is no longer eligible: ${error.message}`);
    }
    throw error;
  }
  const [authority, supervision] = await Promise.all([
    resolveBoundaryAuthority({
      boundaryType,
      sourcePath: sourceArea.path,
      companyId: request.companyId,
      session,
      dependencies: deps,
    }),
    deps.buildSupervisoryOwnership({
      path: destinationArea.path,
      primaryFsdContext: primary.context,
      companyId: request.companyId,
      session,
      dependencies: deps,
    }),
  ]);
  return {
    account,
    current,
    primary,
    sourceArea,
    destinationArea,
    boundaryType,
    authority,
    supervision,
    targetGeographyId: destinationGeographyId,
  };
};

const approveReassignmentRequest = async ({ requestId, payload, user, req = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const decisionReason = requireReason(payload?.decisionReason, "Approval decision reason");
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const request = await loadRequest({ requestId, companyId, session, dependencies: deps });
    if (request.status === REQUEST_STATUSES.APPLIED) {
      await session.abortTransaction().catch(() => {});
      return { applied: true, idempotent: true, operationId: request.operationId, request: requestSummary(request) };
    }
    if (request.status !== REQUEST_STATUSES.PENDING) {
      throw new ApiError(409, `Only PENDING requests may be approved; current status is ${request.status}`);
    }
    const isCrossTransfer = request.requestType === "CROSS_GEOGRAPHY_TRANSFER" ||
      (request.boundaryType && request.boundaryType !== BOUNDARY_TYPES.SAME_AREA);
    const context = isCrossTransfer
      ? await revalidateCrossTransferRequest({ request, session, dependencies: deps })
      : await revalidateSameAreaRequest({ request, user, session, dependencies: deps });
    const approvalLevel = isCrossTransfer
      ? await assertCrossTransferApprovalAuthority({ request, user, context, payload })
      : await assertSameAreaApprovalAuthority({ request, user, context, payload, dependencies: deps });
    const effectiveAt = deps.now();
    const updateResult = await deps.DistributorMapping.updateOne({
      _id: context.current._id,
      companyId,
      isCurrent: true,
      deletedAt: null,
    }, {
      $set: {
        effectiveTo: effectiveAt,
        status: "ended",
        isCurrent: false,
        endedBy: user._id,
        endedOperationId: request.operationId,
        endReason: request.reason,
      },
    }, { session });
    if (Number(updateResult?.modifiedCount ?? updateResult?.nModified ?? 0) !== 1) {
      throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_CURRENT_MAPPING_CHANGED, "Current mapping changed during approval");
    }
    const [newMapping] = await deps.DistributorMapping.create([{
      companyId,
      distributorAccountId: request.distributorAccountId,
      geographyId: context.targetGeographyId,
      geographyType: "AREA",
      primaryFsdId: request.newPrimaryFsdId,
      effectiveFrom: effectiveAt,
      effectiveTo: null,
      status: "current",
      isCurrent: true,
      operationId: request.operationId,
      previousAssignmentId: context.current._id,
      createdBy: user._id,
      assignmentReason: request.reason,
    }], { session });

    context.account.assignedTo = request.newPrimaryFsdId;
    context.account.reportingManagerId = context.primary.context.employee.reportingManagerId ||
      context.primary.context.employee.managerId || null;
    context.account.updatedBy = user._id;
    await context.account.save({ session, validateModifiedOnly: true });

    request.status = REQUEST_STATUSES.APPLIED;
    request.isOpen = false;
    request.reviewedBy = user._id;
    request.decisionReason = decisionReason;
    request.overrideUsed = payload?.override === true || (
      getAccessRole(user) === "sales_head" && (
        sameId(request.requestedBy, user._id) ||
        request.requiredApprovalLevel !== approvalLevel
      )
    );
    request.overrideReason = cleanText(payload?.overrideReason);
    request.reviewedAt = effectiveAt;
    request.appliedAt = effectiveAt;
    request.appliedAssignmentId = newMapping._id;
    request.approvalLevel = approvalLevel;
    await request.save({ session });

    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: isCrossTransfer ? "DISTRIBUTOR_TRANSFER_APPROVED" : "DISTRIBUTOR_REASSIGNMENT_APPROVED",
      entityType: "DistributorReassignmentRequest",
      entityId: request._id,
      metadata: {
        operationId: request.operationId,
        decisionReason,
        approvalLevel,
        requiredApprovalLevel: request.requiredApprovalLevel,
        boundaryType: request.boundaryType || BOUNDARY_TYPES.SAME_AREA,
        sourceGeographyId: request.geographyId,
        destinationGeographyId: context.targetGeographyId,
        oldPrimaryFsdId: request.oldPrimaryFsdId,
        newPrimaryFsdId: request.newPrimaryFsdId,
        requesterId: request.requestedBy,
        approverId: user._id,
        reason: request.reason,
        platformBypass: approvalLevel === APPROVAL_LEVELS.PLATFORM_ADMIN,
        overrideUsed: request.overrideUsed,
        overrideReason: request.overrideReason,
      },
      req,
      session,
    });
    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: isCrossTransfer ? "DISTRIBUTOR_GEOGRAPHY_TRANSFERRED" : "DISTRIBUTOR_REASSIGNED",
      entityType: "DistributorSalesAssignment",
      entityId: newMapping._id,
      metadata: {
        operationId: request.operationId,
        requestId: request._id,
        distributorAccountId: request.distributorAccountId,
        geographyId: context.targetGeographyId,
        sourceGeographyId: request.geographyId,
        destinationGeographyId: context.targetGeographyId,
        boundaryType: request.boundaryType || BOUNDARY_TYPES.SAME_AREA,
        requiredApprovalLevel: request.requiredApprovalLevel,
        requesterId: request.requestedBy,
        approverId: user._id,
        reason: request.reason,
        decisionReason,
        overrideUsed: request.overrideUsed,
        overrideReason: request.overrideReason,
        oldAssignmentId: context.current._id,
        newAssignmentId: newMapping._id,
        oldPrimaryFsdId: request.oldPrimaryFsdId,
        newPrimaryFsdId: request.newPrimaryFsdId,
        effectiveAt,
        platformBypass: approvalLevel === APPROVAL_LEVELS.PLATFORM_ADMIN,
        accountAssignedToSynchronized: true,
        accountReportingManagerSynchronized: true,
      },
      req,
      session,
    });
    await session.commitTransaction();
    return {
      applied: true,
      idempotent: false,
      operationId: request.operationId,
      effectiveAt,
      request: requestSummary(request),
      oldMapping: { ...mappingSummary(context.current), effectiveTo: effectiveAt, status: "ended", isCurrent: false },
      newMapping: mappingSummary(newMapping),
      distributor: accountSummary({
        ...(context.account.toObject?.() || context.account),
        assignedTo: { _id: request.newPrimaryFsdId, ...userSummary(context.primary.context.employee) },
      }),
      ownershipChain: {
        geography: (context.destinationArea || context.area).path,
        primaryFsd: employeeSummary(context.primary.context),
        supervisoryOwnership: context.supervision.chain,
      },
      warnings: context.supervision.warnings,
    };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000 || error?.code === 112 || error?.codeName === "WriteConflict") {
      throw codedError(409, REASSIGNMENT_CODES.REQUEST_STALE_CURRENT_MAPPING_CHANGED, "A competing ownership change was applied");
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

const decideWithoutApply = async ({ requestId, payload, user, req, status, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId, role } = assertReassignmentAccess(user);
  const decisionReason = requireReason(payload?.decisionReason, `${status === REQUEST_STATUSES.REJECTED ? "Rejection" : "Cancellation"} reason`);
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const request = await loadRequest({ requestId, companyId, session, dependencies: deps });
    if (request.status !== REQUEST_STATUSES.PENDING) {
      throw new ApiError(409, `Only PENDING requests may be ${status.toLowerCase()}`);
    }
    if (status === REQUEST_STATUSES.CANCELLED) {
      if (!sameId(request.requestedBy, user._id) && !["super_admin", "company_admin"].includes(role)) {
        throw new ApiError(403, "Only the requester or a platform administrator may cancel a pending request");
      }
    } else {
      const isCrossTransfer = request.requestType === "CROSS_GEOGRAPHY_TRANSFER" ||
        (request.boundaryType && request.boundaryType !== BOUNDARY_TYPES.SAME_AREA);
      if (isCrossTransfer) {
        const rule = BOUNDARY_AUTHORITY[request.boundaryType];
        const authority = await loadCurrentResponsibleManager({
          hierarchyLevel: rule.level,
          geographyId: request.approvalScopeGeographyId,
          geographyType: rule.geographyType,
          companyId,
          session,
          dependencies: deps,
        });
        await assertCrossTransferApprovalAuthority({
          request,
          user,
          context: { authority: { ...rule, ...authority }, boundaryType: request.boundaryType },
          payload: { ...payload, decisionReason },
        });
      } else {
        const asm = await loadCurrentAreaAsm({ areaId: request.geographyId, companyId, session, dependencies: deps });
        await assertSameAreaApprovalAuthority({ request, user, context: { asm }, payload: { ...payload, decisionReason }, dependencies: deps });
      }
    }
    const now = deps.now();
    request.status = status;
    request.isOpen = false;
    request.reviewedBy = user._id;
    request.decisionReason = decisionReason;
    request.overrideUsed = payload?.override === true;
    request.overrideReason = cleanText(payload?.overrideReason);
    request.reviewedAt = now;
    if (status === REQUEST_STATUSES.CANCELLED) request.cancelledAt = now;
    await request.save({ session });
    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: request.requestType === "CROSS_GEOGRAPHY_TRANSFER"
        ? (status === REQUEST_STATUSES.REJECTED ? "DISTRIBUTOR_TRANSFER_REJECTED" : "DISTRIBUTOR_TRANSFER_CANCELLED")
        : (status === REQUEST_STATUSES.REJECTED ? "DISTRIBUTOR_REASSIGNMENT_REJECTED" : "DISTRIBUTOR_REASSIGNMENT_CANCELLED"),
      entityType: "DistributorReassignmentRequest",
      entityId: request._id,
      metadata: {
        operationId: request.operationId,
        decisionReason,
        boundaryType: request.boundaryType || BOUNDARY_TYPES.SAME_AREA,
        sourceGeographyId: request.geographyId,
        destinationGeographyId: request.destinationGeographyId || request.geographyId,
        oldPrimaryFsdId: request.oldPrimaryFsdId,
        newPrimaryFsdId: request.newPrimaryFsdId,
        requiredApprovalLevel: request.requiredApprovalLevel,
        requesterId: request.requestedBy,
        approverId: user._id,
        reason: request.reason,
        overrideUsed: request.overrideUsed,
        overrideReason: request.overrideReason,
      },
      req,
      session,
    });
    await session.commitTransaction();
    return { request: requestSummary(request) };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
};

const rejectReassignmentRequest = (input) => decideWithoutApply({ ...input, status: REQUEST_STATUSES.REJECTED });
const cancelReassignmentRequest = (input) => decideWithoutApply({ ...input, status: REQUEST_STATUSES.CANCELLED });

const resolveNames = async (requests, deps, companyId) => {
  const ids = [...new Set((requests || []).flatMap((item) => [
    item.oldPrimaryFsdId,
    item.newPrimaryFsdId,
    item.requestedBy,
    item.reviewedBy,
  ]).map(toId).filter(Boolean))];
  if (!ids.length) return new Map();
  const users = await deps.User.find({ companyId, _id: { $in: ids } });
  return new Map((users || []).map((item) => [toId(item._id), userSummary(item)]));
};

const resolveReadReferences = async (requests, deps, companyId) => {
  const accountIds = [...new Set((requests || []).map((item) => toId(item.distributorAccountId)).filter(Boolean))];
  const geographyIds = [...new Set((requests || []).flatMap((item) => [
    item.geographyId,
    item.destinationGeographyId,
  ]).map(toId).filter(Boolean))];
  const [accountRows, geographyRows] = await Promise.all([
    accountIds.length ? deps.Account.find({ companyId, _id: { $in: accountIds }, deletedAt: null }) : [],
    geographyIds.length ? deps.Geography.find({ companyId, _id: { $in: geographyIds }, deletedAt: null }) : [],
  ]);
  return {
    accounts: new Map((accountRows || []).map((item) => [toId(item._id), accountSummary(item)])),
    geographies: new Map((geographyRows || []).map((item) => [toId(item._id), {
      id: item._id,
      name: item.name || "",
      code: item.code || "",
      type: item.type || "AREA",
    }])),
  };
};

const canSeeRequest = async ({ request, user, companyId, dependencies = {} }) => {
  const role = getAccessRole(user);
  if (["super_admin", "company_admin", "sales_head"].includes(role) || sameId(request.requestedBy, user._id)) return true;
  if (request.requestType === "CROSS_GEOGRAPHY_TRANSFER" ||
      (request.boundaryType && request.boundaryType !== BOUNDARY_TYPES.SAME_AREA)) {
    const rule = BOUNDARY_AUTHORITY[request.boundaryType];
    if (!rule) return false;
    const manager = await loadCurrentResponsibleManager({
      hierarchyLevel: rule.level,
      geographyId: request.approvalScopeGeographyId,
      geographyType: rule.geographyType,
      companyId,
      dependencies,
    });
    return Boolean(manager.employee && sameId(manager.employee._id, user._id));
  }
  const asm = await loadCurrentAreaAsm({ areaId: request.geographyId, companyId, dependencies });
  return Boolean(asm.employee && sameId(asm.employee._id, user._id));
};

const canApproveRequest = async ({ request, user, companyId, dependencies = {} }) => {
  const role = getAccessRole(user);
  if (["super_admin", "company_admin", "sales_head"].includes(role)) return true;
  if (role !== "sales_manager" || sameId(request.requestedBy, user._id)) return false;
  const isCrossTransfer = request.requestType === "CROSS_GEOGRAPHY_TRANSFER" ||
    (request.boundaryType && request.boundaryType !== BOUNDARY_TYPES.SAME_AREA);
  if (isCrossTransfer) {
    const rule = BOUNDARY_AUTHORITY[request.boundaryType];
    if (!rule || request.approvalLevel !== rule.approvalLevel) return false;
    const manager = await loadCurrentResponsibleManager({
      hierarchyLevel: rule.level,
      geographyId: request.approvalScopeGeographyId,
      geographyType: rule.geographyType,
      companyId,
      dependencies,
    });
    return Boolean(manager.employee && sameId(manager.employee._id, user._id));
  }
  if (request.approvalLevel !== APPROVAL_LEVELS.ASM) return false;
  const asm = await loadCurrentAreaAsm({ areaId: request.geographyId, companyId, dependencies });
  return Boolean(asm.employee && sameId(asm.employee._id, user._id));
};

const listReassignmentRequests = async ({ query = {}, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const filter = { companyId, deletedAt: null };
  if (query.status && Object.values(REQUEST_STATUSES).includes(query.status)) filter.status = query.status;
  if (query.distributorAccountId) filter.distributorAccountId = query.distributorAccountId;
  const requests = await withSort(deps.ReassignmentRequest.find(filter), { createdAt: -1 });
  const visible = [];
  for (const request of requests || []) {
    if (await canSeeRequest({ request, user, companyId, dependencies: deps })) visible.push(request);
  }
  const names = await resolveNames(visible, deps, companyId);
  const references = await resolveReadReferences(visible, deps, companyId);
  return visible.map((item) => requestSummary(item, names, references.accounts, references.geographies));
};

const listApprovalQueue = async ({ user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const requests = await withSort(deps.ReassignmentRequest.find({
    companyId,
    status: REQUEST_STATUSES.PENDING,
    deletedAt: null,
  }), { createdAt: -1 });
  const actionable = [];
  for (const request of requests || []) {
    if (await canApproveRequest({ request, user, companyId, dependencies: deps })) actionable.push(request);
  }
  const names = await resolveNames(actionable, deps, companyId);
  const references = await resolveReadReferences(actionable, deps, companyId);
  return actionable.map((item) => requestSummary(item, names, references.accounts, references.geographies));
};

const getReassignmentRequest = async ({ requestId, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const request = await loadRequest({ requestId, companyId, dependencies: deps });
  if (!(await canSeeRequest({ request, user, companyId, dependencies: deps }))) {
    throw new ApiError(403, "This Distributor request is outside the actor's current structured Geography authority");
  }
  const names = await resolveNames([request], deps, companyId);
  const references = await resolveReadReferences([request], deps, companyId);
  return requestSummary(request, names, references.accounts, references.geographies);
};

const listEligibleReassignmentFsds = async ({ accountId, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const current = await loadCurrentMappingStrict({ accountId, companyId, dependencies: deps });
  await assertRequesterAuthority({ user, areaId: current.geographyId, companyId, dependencies: deps });
  const area = await deps.validateArea({ areaId: current.geographyId, companyId, dependencies: deps });
  const assignments = await deps.EmployeeAssignment.find({
    companyId,
    geographyId: current.geographyId,
    geographyType: "AREA",
    hierarchyLevel: 1,
    isCurrent: true,
    deletedAt: null,
  });
  const candidates = [];
  for (const assignment of assignments || []) {
    if (sameId(assignment.employeeId, current.primaryFsdId)) continue;
    try {
      const validated = await deps.validatePrimaryFsd({
        fsdId: assignment.employeeId,
        areaId: current.geographyId,
        companyId,
        dependencies: deps,
      });
      const managerId = validated.context.employee.reportingManagerId || validated.context.employee.managerId;
      const manager = managerId ? await deps.User.findOne({ _id: managerId, companyId, deletedAt: null }) : null;
      candidates.push({
        ...employeeSummary(validated.context),
        areaId: current.geographyId,
        area: area.path.area,
        assignmentId: assignment._id,
        reportingManager: userSummary(manager),
      });
    } catch (error) {
      if (![400, 404, 409].includes(error.statusCode)) throw error;
    }
  }
  return candidates.sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
};

const listEligibleFsdsForArea = async ({ areaId, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const area = await deps.validateArea({ areaId, companyId, dependencies: deps });
  const assignments = await deps.EmployeeAssignment.find({
    companyId,
    geographyId: area.target._id,
    geographyType: "AREA",
    hierarchyLevel: 1,
    isCurrent: true,
    deletedAt: null,
  });
  const candidates = [];
  for (const assignment of assignments || []) {
    try {
      const validated = await deps.validatePrimaryFsd({
        fsdId: assignment.employeeId,
        areaId: area.target._id,
        companyId,
        dependencies: deps,
      });
      const managerId = validated.context.employee.reportingManagerId || validated.context.employee.managerId;
      const manager = managerId ? await deps.User.findOne({ _id: managerId, companyId, deletedAt: null }) : null;
      candidates.push({
        ...employeeSummary(validated.context),
        areaId: area.target._id,
        area: area.path.area,
        assignmentId: assignment._id,
        reportingManager: userSummary(manager),
      });
    } catch (error) {
      if (![400, 404, 409].includes(error.statusCode)) throw error;
    }
  }
  return candidates.sort((left, right) => String(left.fullName).localeCompare(String(right.fullName)));
};

const listTransferOptions = async ({ user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const areas = await deps.Geography.find({
    companyId,
    type: "AREA",
    status: "active",
    deletedAt: null,
  });
  const options = [];
  for (const area of areas || []) {
    try {
      const resolved = await deps.validateArea({ areaId: area._id, companyId, dependencies: deps });
      options.push({
        id: area._id,
        name: area.name || "",
        code: area.code || "",
        path: resolved.path,
        label: ["zone", "region", "branch", "area"]
          .map((key) => resolved.path?.[key]?.name)
          .filter(Boolean)
          .join(" → "),
      });
    } catch (error) {
      if (![400, 404, 409].includes(error.statusCode)) throw error;
    }
  }
  return options.sort((left, right) => left.label.localeCompare(right.label));
};

const listReassignmentReadiness = async ({ user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId, role } = assertReassignmentAccess(user);
  const pending = await listApprovalQueue({ user, dependencies: deps });
  if (role === "sales_manager") {
    return { summary: { needsReassignment: 0, pending: pending.length }, needsReassignment: [], pendingRequests: pending };
  }
  const readiness = await deps.listDistributorMappingReadiness({ user, dependencies: deps });
  const needsReassignment = (readiness.distributors || []).filter((row) => row.requiresReassignment === true);
  return {
    summary: { needsReassignment: needsReassignment.length, pending: pending.length },
    needsReassignment,
    pendingRequests: pending,
  };
};

const getReassignmentHistory = async ({ accountId = null, at = null, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertReassignmentAccess(user);
  const requestFilter = { companyId, deletedAt: null };
  const mappingFilter = { companyId, deletedAt: null };
  if (accountId) {
    requestFilter.distributorAccountId = accountId;
    mappingFilter.distributorAccountId = accountId;
  }
  const [allRequests, allMappings] = await Promise.all([
    withSort(deps.ReassignmentRequest.find(requestFilter), { createdAt: -1 }),
    withSort(deps.DistributorMapping.find(mappingFilter), { effectiveFrom: -1 }),
  ]);
  const role = getAccessRole(user);
  let requests = allRequests || [];
  let mappings = allMappings || [];
  if (role === "sales_manager") {
    const visible = [];
    for (const request of requests) {
      if (await canSeeRequest({ request, user, companyId, dependencies: deps })) visible.push(request);
    }
    requests = visible;
    const visibleDistributorIds = new Set(requests.map((item) => toId(item.distributorAccountId)));
    mappings = mappings.filter((item) => visibleDistributorIds.has(toId(item.distributorAccountId)));
  }
  const names = await resolveNames(requests, deps, companyId);
  const references = await resolveReadReferences(requests, deps, companyId);
  let ownerAt = null;
  if (accountId && at) {
    const instant = new Date(at);
    if (Number.isNaN(instant.getTime())) throw new ApiError(400, "at must be a valid date/time");
    const match = (mappings || []).find((item) => {
      const from = new Date(item.effectiveFrom).getTime();
      const to = item.effectiveTo ? new Date(item.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
      return from <= instant.getTime() && instant.getTime() < to;
    }) || null;
    if (match) {
      let owner = names.get(toId(match.primaryFsdId));
      if (!owner) owner = userSummary(await deps.User.findOne({ _id: match.primaryFsdId, companyId }));
      const geography = await deps.Geography.findOne({ _id: match.geographyId, companyId });
      ownerAt = { at: instant, owner, geography: geography ? {
        id: geography._id,
        name: geography.name || "",
        code: geography.code || "",
        type: geography.type || "AREA",
      } : null, assignment: mappingSummary(match) };
    }
  }
  const mappingGeographyIds = [...new Set((mappings || []).map((item) => toId(item.geographyId)).filter(Boolean))];
  const mappingOwnerIds = [...new Set((mappings || []).map((item) => toId(item.primaryFsdId)).filter(Boolean))];
  const mappingGeographies = mappingGeographyIds.length
    ? await deps.Geography.find({ companyId, _id: { $in: mappingGeographyIds } })
    : [];
  const mappingOwners = mappingOwnerIds.length
    ? await deps.User.find({ companyId, _id: { $in: mappingOwnerIds } })
    : [];
  const mappingOwnerById = new Map((mappingOwners || []).map((item) => [toId(item._id), userSummary(item)]));
  const mappingGeographyById = new Map((mappingGeographies || []).map((item) => [toId(item._id), {
    id: item._id,
    name: item.name || "",
    code: item.code || "",
    type: item.type || "AREA",
  }]));
  return {
    requests: (requests || []).map((item) => requestSummary(item, names, references.accounts, references.geographies)),
    assignments: (mappings || []).map((item) => ({
      ...mappingSummary(item),
      geography: mappingGeographyById.get(toId(item.geographyId)) || null,
      primaryFsd: mappingOwnerById.get(toId(item.primaryFsdId)) || null,
    })),
    ownerAt,
  };
};

module.exports = {
  assertReassignmentAccess,
  loadCurrentMappingStrict,
  loadCurrentAreaAsm,
  buildReassignmentPreview,
  createReassignmentRequest,
  approveReassignmentRequest,
  rejectReassignmentRequest,
  cancelReassignmentRequest,
  listReassignmentRequests,
  listApprovalQueue,
  getReassignmentRequest,
  listEligibleReassignmentFsds,
  listEligibleFsdsForArea,
  listTransferOptions,
  listReassignmentReadiness,
  getReassignmentHistory,
  requestSummary,
};
