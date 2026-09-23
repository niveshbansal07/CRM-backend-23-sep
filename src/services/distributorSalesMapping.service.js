const mongoose = require("mongoose");
const Account = require("../models/Account");
const CrmMaster = require("../models/CrmMaster");
const User = require("../models/User");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const DistributorSalesAssignment = require("../models/DistributorSalesAssignment");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const { isSalesDepartment } = require("../constants/salesHierarchy");
const {
  DISTRIBUTOR_MAPPING_MANAGE_ROLES,
  DISTRIBUTOR_MAPPING_STATES,
  SUPERVISORY_VACANCY_CODES,
} = require("../constants/distributorSalesMapping");
const {
  assertCanonicalDistributorAccount,
  getAccountTypeMaster,
  isCanonicalDistributorType,
  allocateDistributorBusinessId,
} = require("./distributorAccount.service");
const {
  resolveSalesDesignationIdentity,
  findEmployeeContext,
  findCurrentAssignment,
  loadGeographyPath,
} = require("./salesGeographyAssignment.service");
const { writeAuditLog } = require("./auditLog.service");

const DEFAULT_DEPS = {
  Account,
  CrmMaster,
  User,
  Geography: SalesGeography,
  EmployeeAssignment: SalesEmployeeGeographyAssignment,
  DistributorMapping: DistributorSalesAssignment,
  findEmployeeContext,
  findCurrentAssignment,
  loadGeographyPath,
  writeAuditLog,
  allocateDistributorBusinessId,
  startSession: () => mongoose.startSession(),
  now: () => new Date(),
  newOperationId: () => new mongoose.Types.ObjectId(),
};

const depsFor = (dependencies = {}) => ({ ...DEFAULT_DEPS, ...dependencies });
const toId = (value) => String(value?._id || value?.id || value || "");
const sameId = (first, second) => Boolean(toId(first)) && toId(first) === toId(second);
const withSession = (query, session) => session && query?.session ? query.session(session) : query;
const populate = (query, path, select) => query?.populate ? query.populate(path, select) : query;
const cleanReason = (value) => String(value || "").trim().replace(/\s+/g, " ");

const requireReason = (value) => {
  const reason = cleanReason(value);
  if (reason.length < 2) throw new ApiError(400, "An initial mapping reason is required");
  if (reason.length > 500) throw new ApiError(400, "Mapping reason must be 500 characters or less");
  return reason;
};

const assertCanManageDistributorMappings = (user) => {
  const role = getAccessRole(user);
  if (!DISTRIBUTOR_MAPPING_MANAGE_ROLES.includes(role)) {
    throw new ApiError(403, "Only Head of Sales and platform administrators can manage Distributor Sales mappings");
  }
  const companyId = user?.companyId?._id || user?.companyId;
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

const accountSummary = (account) => ({
  id: account?._id,
  distributorBusinessId: account?.distributorBusinessId || null,
  name: account?.name || "",
  ownerName: account?.ownerName || "",
  phone: account?.phone || "",
  email: account?.email || "",
  address: account?.address || "",
  state: account?.state || "",
  city: account?.city || "",
  pincode: account?.pincode || "",
  status: account?.status || "",
  accountType: account?.accountTypeId ? {
    id: account.accountTypeId._id || account.accountTypeId,
    code: account.accountTypeId.code || "",
    name: account.accountTypeId.name || account.accountType || "",
  } : null,
  assignedTo: account?.assignedTo ? {
    id: account.assignedTo._id || account.assignedTo,
    fullName: account.assignedTo.fullName || "",
    employeeId: account.assignedTo.employeeId || "",
    status: account.assignedTo.status || "",
  } : null,
  creditLimit: account?.creditLimit ?? 0,
  paymentTerms: account?.paymentTerms || "",
  appointmentDate: account?.appointmentDate || null,
  territory: account?.territory || "",
});

const mappingSummary = (mapping) => mapping ? ({
  id: mapping._id,
  operationId: mapping.operationId,
  endedOperationId: mapping.endedOperationId || null,
  previousAssignmentId: mapping.previousAssignmentId || null,
  distributorAccountId: mapping.distributorAccountId,
  geographyId: mapping.geographyId,
  geographyType: mapping.geographyType,
  primaryFsdId: mapping.primaryFsdId,
  effectiveFrom: mapping.effectiveFrom,
  effectiveTo: mapping.effectiveTo,
  status: mapping.status,
  isCurrent: mapping.isCurrent,
  createdBy: mapping.createdBy,
  endedBy: mapping.endedBy || null,
  assignmentReason: mapping.assignmentReason,
  endReason: mapping.endReason || "",
}) : null;

const employeeSummary = (context) => context ? ({
  id: context.employee._id,
  fullName: context.employee.fullName,
  employeeId: context.employee.employeeId || "",
  status: context.employee.status,
  designation: context.identity.designation || null,
  hierarchyLevel: context.identity.hierarchyLevel || null,
  technicalRole: context.identity.technicalRole || getAccessRole(context.employee),
  reportingManagerId: context.employee.reportingManagerId || context.employee.managerId || null,
}) : null;

const assignmentDeps = (deps) => ({
  User: deps.User,
  Geography: deps.Geography,
  Assignment: deps.EmployeeAssignment,
});

const loadDistributorAccount = async ({ accountId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  let query = deps.Account.findOne({ _id: accountId, companyId, deletedAt: null });
  query = populate(query, "accountTypeId", "name code module type isActive");
  query = populate(query, "assignedTo", "fullName email employeeId status role systemRole reportingManagerId managerId");
  const account = await withSession(query, session);
  if (!account) throw new ApiError(404, "Distributor Account not found");
  await assertCanonicalDistributorAccount({
    account,
    companyId,
    session,
    CrmMasterModel: deps.CrmMaster,
  });
  return account;
};

const loadCurrentMapping = async ({ accountId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  return withSession(deps.DistributorMapping.findOne({
    companyId,
    distributorAccountId: accountId,
    isCurrent: true,
    deletedAt: null,
  }), session);
};

const validateArea = async ({ areaId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const result = await deps.loadGeographyPath({
    geographyId: areaId,
    companyId,
    activeOnly: true,
    dependencies: assignmentDeps(deps),
    session,
  });
  if (result.target.type !== "AREA") throw new ApiError(400, "Distributor Geography must be an AREA");
  return result;
};

const validatePrimaryFsd = async ({ fsdId, areaId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const context = await deps.findEmployeeContext({
    employeeId: fsdId,
    companyId,
    dependencies: assignmentDeps(deps),
    session,
  });
  if (!isSalesDepartment(context.department) || !context.identity.valid || context.identity.hierarchyLevel !== 1) {
    throw new ApiError(400, "Primary FSD must have an unambiguous structured L1 Sales designation");
  }
  if (context.identity.technicalRole !== "sales_executive" || getAccessRole(context.employee) !== "sales_executive") {
    throw new ApiError(400, "Primary FSD must use the sales_executive technical role");
  }
  if (context.employee.status !== "active" || context.employee.deletedAt) {
    throw new ApiError(409, "Primary FSD must be active");
  }
  const assignment = await deps.findCurrentAssignment({
    employeeId: fsdId,
    companyId,
    dependencies: assignmentDeps(deps),
    session,
  });
  if (!assignment) throw new ApiError(409, "Primary FSD must have a current Area assignment");
  if (assignment.geographyType !== "AREA" || Number(assignment.hierarchyLevel) !== 1) {
    throw new ApiError(409, "Primary FSD current assignment must be an L1 Area assignment");
  }
  if (!sameId(assignment.geographyId, areaId)) {
    throw new ApiError(409, "Primary FSD Geography must match the Distributor Area");
  }
  return { context, assignment };
};

const buildSupervisoryOwnership = async ({
  path,
  primaryFsdContext,
  companyId,
  session = null,
  dependencies = {},
}) => {
  const deps = depsFor(dependencies);
  const geographyByLevel = {
    2: path.area?.id,
    3: path.branch?.id,
    4: path.region?.id,
    5: path.zone?.id,
  };
  const geographyIds = Object.values(geographyByLevel).filter(Boolean);
  const assignments = await withSession(deps.EmployeeAssignment.find({
    companyId,
    geographyId: { $in: geographyIds },
    isCurrent: true,
    isResponsibleManager: true,
    deletedAt: null,
  }), session);
  const byLevel = new Map((assignments || []).map((item) => [Number(item.hierarchyLevel), item]));
  const managerIds = [...new Set((assignments || []).map((item) => toId(item.employeeId)).filter(Boolean))];
  let managerQuery = deps.User.find({
    companyId,
    _id: { $in: managerIds },
    status: "active",
    deletedAt: null,
  });
  managerQuery = populate(managerQuery, "designationId", "name title code hierarchyLevel mappedRole status");
  managerQuery = populate(managerQuery, "departmentId", "name code slug normalizedName status");
  const managers = managerIds.length ? await withSession(managerQuery, session) : [];
  const managerById = new Map((managers || []).map((item) => [toId(item._id), item]));

  let headQuery = deps.User.find({
    companyId,
    status: "active",
    deletedAt: null,
    $or: [{ role: "sales_head" }, { systemRole: "sales_head" }],
  });
  headQuery = populate(headQuery, "designationId", "name title code hierarchyLevel mappedRole status");
  headQuery = populate(headQuery, "departmentId", "name code slug normalizedName status");
  const headCandidates = await withSession(headQuery, session);
  const head = (headCandidates || []).find((candidate) => {
    const identity = resolveSalesDesignationIdentity({
      employee: candidate,
      designation: candidate.designationId,
      department: candidate.departmentId,
    });
    return identity.valid && identity.hierarchyLevel === 6;
  }) || null;

  const labels = { 2: "asm", 3: "branchManager", 4: "rsm", 5: "zsm" };
  const chain = {};
  const warnings = [];
  [2, 3, 4, 5].forEach((level) => {
    const assignment = byLevel.get(level);
    const employee = assignment ? managerById.get(toId(assignment.employeeId)) : null;
    chain[labels[level]] = employee ? {
      id: employee._id,
      fullName: employee.fullName,
      employeeId: employee.employeeId || "",
      hierarchyLevel: level,
      geographyId: geographyByLevel[level],
    } : null;
    if (!employee) warnings.push(SUPERVISORY_VACANCY_CODES[level]);
  });
  chain.headOfSales = head ? {
    id: head._id,
    fullName: head.fullName,
    employeeId: head.employeeId || "",
    hierarchyLevel: 6,
    geographyId: null,
  } : null;
  if (!head) warnings.push(SUPERVISORY_VACANCY_CODES[6]);

  const directManagerId = primaryFsdContext?.employee?.reportingManagerId || primaryFsdContext?.employee?.managerId;
  const supervisorIds = [chain.asm, chain.branchManager, chain.rsm, chain.zsm, chain.headOfSales]
    .map((item) => toId(item?.id))
    .filter(Boolean);
  if (!directManagerId) warnings.push("PRIMARY_FSD_REPORTING_MANAGER_MISSING");
  else if (!supervisorIds.includes(toId(directManagerId))) warnings.push("PRIMARY_FSD_REPORTING_MISMATCH");

  return { chain, warnings: [...new Set(warnings)] };
};

const buildInitialDistributorMappingPreview = async ({
  payload,
  user,
  session = null,
  dependencies = {},
}) => {
  const companyId = assertCanManageDistributorMappings(user);
  const deps = depsFor(dependencies);
  const reason = requireReason(payload?.reason);
  const account = await loadDistributorAccount({
    accountId: payload.accountId,
    companyId,
    session,
    dependencies: deps,
  });
  const existingMapping = await loadCurrentMapping({
    accountId: account._id,
    companyId,
    session,
    dependencies: deps,
  });
  const area = await validateArea({
    areaId: payload.areaId,
    companyId,
    session,
    dependencies: deps,
  });
  const primary = await validatePrimaryFsd({
    fsdId: payload.primaryFsdId,
    areaId: area.target._id,
    companyId,
    session,
    dependencies: deps,
  });
  const supervision = await buildSupervisoryOwnership({
    path: area.path,
    primaryFsdContext: primary.context,
    companyId,
    session,
    dependencies: deps,
  });
  const blockers = [];
  const warnings = [...supervision.warnings];
  if (existingMapping) blockers.push(DISTRIBUTOR_MAPPING_STATES.CURRENT_MAPPING_EXISTS);
  const currentAssigneeId = account.assignedTo?._id || account.assignedTo;
  if (currentAssigneeId && !sameId(currentAssigneeId, primary.context.employee._id)) {
    blockers.push(DISTRIBUTOR_MAPPING_STATES.EXISTING_ASSIGNEE_CONFLICT);
  } else if (currentAssigneeId) {
    warnings.push("REUSE_EXISTING_ASSIGNEE_AS_PRIMARY_FSD");
  }
  const activateAfterMapping = payload.activateAfterMapping === true;
  return {
    canApply: blockers.length === 0,
    operationType: "INITIAL_DISTRIBUTOR_SALES_MAPPING",
    reason,
    distributor: accountSummary(account),
    existingMapping: mappingSummary(existingMapping),
    proposed: {
      geographyId: area.target._id,
      geographyType: "AREA",
      geography: area.path,
      primaryFsd: employeeSummary(primary.context),
      primaryFsdAssignment: {
        id: primary.assignment._id,
        geographyId: primary.assignment.geographyId,
        geographyType: primary.assignment.geographyType,
      },
      supervisoryOwnership: supervision.chain,
    },
    accountAssigneeDecision: currentAssigneeId
      ? (sameId(currentAssigneeId, primary.context.employee._id)
          ? "REUSE_EXISTING_ASSIGNEE_AS_PRIMARY_FSD"
          : DISTRIBUTOR_MAPPING_STATES.EXISTING_ASSIGNEE_CONFLICT)
      : "SYNCHRONIZE_ACCOUNT_ASSIGNEE",
    activation: {
      currentStatus: account.status,
      requested: activateAfterMapping,
      ready: blockers.length === 0,
      willActivate: activateAfterMapping && account.status !== "active" && blockers.length === 0,
      legacyActiveUnmapped: account.status === "active" && !existingMapping,
    },
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
  };
};

const applyInitialDistributorMapping = async ({ payload, user, req = null, dependencies = {} }) => {
  const companyId = assertCanManageDistributorMappings(user);
  const deps = depsFor(dependencies);
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const preview = await buildInitialDistributorMappingPreview({ payload, user, session, dependencies: deps });
    if (!preview.canApply) {
      throw new ApiError(409, "Initial Distributor mapping contains blocking conflicts", preview.blockers);
    }
    const account = await loadDistributorAccount({
      accountId: payload.accountId,
      companyId,
      session,
      dependencies: deps,
    });
    const effectiveAt = deps.now();
    const operationId = deps.newOperationId();
    const [mapping] = await deps.DistributorMapping.create([{
      companyId,
      distributorAccountId: account._id,
      geographyId: preview.proposed.geographyId,
      geographyType: "AREA",
      primaryFsdId: preview.proposed.primaryFsd.id,
      effectiveFrom: effectiveAt,
      effectiveTo: null,
      status: "current",
      isCurrent: true,
      operationId,
      createdBy: user._id,
      assignmentReason: preview.reason,
    }], { session });

    if (!account.distributorBusinessId) {
      account.$locals.allowDistributorBusinessIdInitialization = true;
      account.distributorBusinessId = await deps.allocateDistributorBusinessId({
        companyId,
        session,
      });
    }
    account.assignedTo = preview.proposed.primaryFsd.id;
    account.reportingManagerId = preview.proposed.primaryFsd.reportingManagerId || null;
    const previousStatus = account.status;
    if (payload.activateAfterMapping === true) account.status = "active";
    account.updatedBy = user._id;
    await account.save({ session, validateModifiedOnly: true });

    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action: "DISTRIBUTOR_SALES_MAPPING_CREATED",
      entityType: "DistributorSalesAssignment",
      entityId: mapping._id,
      metadata: {
        operationId,
        effects: [
          "DISTRIBUTOR_PRIMARY_FSD_INITIALIZED",
          ...(previousStatus !== "active" && account.status === "active"
            ? ["DISTRIBUTOR_ACTIVATED_AFTER_MAPPING"]
            : []),
        ],
        distributorAccountId: account._id,
        distributorBusinessId: account.distributorBusinessId,
        geographyId: mapping.geographyId,
        primaryFsdId: mapping.primaryFsdId,
        accountAssignedToSynchronized: true,
        primaryFsdInitialized: true,
        activatedAfterMapping: previousStatus !== "active" && account.status === "active",
        previousStatus,
        currentStatus: account.status,
        reason: preview.reason,
      },
      req,
      session,
    });
    await session.commitTransaction();
    return {
      applied: true,
      operationId,
      mapping: mappingSummary(mapping),
      distributor: accountSummary({
        ...(account.toObject?.() || account),
        accountTypeId: account.accountTypeId,
        assignedTo: {
          _id: preview.proposed.primaryFsd.id,
          fullName: preview.proposed.primaryFsd.fullName,
          employeeId: preview.proposed.primaryFsd.employeeId,
          status: preview.proposed.primaryFsd.status,
        },
      }),
      ownershipChain: preview.proposed,
      warnings: preview.warnings,
    };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000) throw new ApiError(409, "A current Distributor mapping was created concurrently");
    throw error;
  } finally {
    await session.endSession();
  }
};

const listEligiblePrimaryFsds = async ({ areaId, user, dependencies = {} }) => {
  const companyId = assertCanManageDistributorMappings(user);
  const deps = depsFor(dependencies);
  const area = await validateArea({ areaId, companyId, dependencies: deps });
  const assignments = await deps.EmployeeAssignment.find({
    companyId,
    geographyId: areaId,
    geographyType: "AREA",
    hierarchyLevel: 1,
    isCurrent: true,
    deletedAt: null,
  });
  const candidates = [];
  for (const assignment of assignments || []) {
    try {
      const validated = await validatePrimaryFsd({
        fsdId: assignment.employeeId,
        areaId,
        companyId,
        dependencies: deps,
      });
      candidates.push({
        ...employeeSummary(validated.context),
        areaId,
        area: area.path.area,
        assignmentId: assignment._id,
      });
    } catch {
      // Candidate lookups omit invalid, inactive, ambiguous, or cross-tenant users.
    }
  }
  const managerIds = [...new Set(candidates.map((item) => toId(item.reportingManagerId)).filter(Boolean))];
  const managers = managerIds.length ? await deps.User.find({
    _id: { $in: managerIds },
    companyId,
    status: "active",
    deletedAt: null,
  }) : [];
  const managerById = new Map((managers || []).map((item) => [toId(item._id), item]));
  return candidates
    .map((candidate) => ({
      ...candidate,
      reportingManager: candidate.reportingManagerId ? {
        id: candidate.reportingManagerId,
        fullName: managerById.get(toId(candidate.reportingManagerId))?.fullName || "Unavailable manager",
      } : null,
    }))
    .sort((first, second) => String(first.fullName).localeCompare(String(second.fullName)));
};

const evaluateCurrentMapping = async ({ account, mapping, companyId, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  if (!mapping) {
    let existingAssignee = null;
    if (account.assignedTo) {
      try {
        const context = await deps.findEmployeeContext({
          employeeId: account.assignedTo?._id || account.assignedTo,
          companyId,
          dependencies: assignmentDeps(deps),
        });
        const assignment = await deps.findCurrentAssignment({
          employeeId: context.employee._id,
          companyId,
          dependencies: assignmentDeps(deps),
        });
        const eligible = context.employee.status === "active" && context.identity.valid &&
          context.identity.hierarchyLevel === 1 && assignment?.geographyType === "AREA";
        existingAssignee = {
          ...employeeSummary(context),
          eligible,
          suggestedAreaId: eligible ? assignment.geographyId : null,
          state: eligible ? "EXISTING_ELIGIBLE_ASSIGNEE" : "EXISTING_INVALID_ASSIGNEE",
        };
      } catch {
        existingAssignee = { id: account.assignedTo?._id || account.assignedTo, eligible: false, state: "EXISTING_INVALID_ASSIGNEE" };
      }
    }
    return {
      state: account.status === "active"
        ? DISTRIBUTOR_MAPPING_STATES.LEGACY_ACTIVE_UNMAPPED
        : DISTRIBUTOR_MAPPING_STATES.UNMAPPED,
      requiresReassignment: false,
      existingAssignee,
      geography: null,
      primaryFsd: null,
      supervisoryOwnership: null,
      warnings: [],
    };
  }

  let pathResult;
  try {
    pathResult = await deps.loadGeographyPath({
      geographyId: mapping.geographyId,
      companyId,
      activeOnly: false,
      dependencies: assignmentDeps(deps),
    });
  } catch {
    return { state: DISTRIBUTOR_MAPPING_STATES.GEOGRAPHY_INACTIVE, requiresReassignment: true, warnings: ["GEOGRAPHY_UNAVAILABLE"] };
  }
  const pathInactive = pathResult.records.some((item) => item.status !== "active" || item.isActive === false || item.isArchived === true);
  let fsdContext;
  try {
    fsdContext = await deps.findEmployeeContext({
      employeeId: mapping.primaryFsdId,
      companyId,
      dependencies: assignmentDeps(deps),
    });
  } catch {
    return {
      state: DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_INACTIVE,
      requiresReassignment: true,
      geography: pathResult.path,
      warnings: [DISTRIBUTOR_MAPPING_STATES.REASSIGNMENT_REQUIRED],
    };
  }
  const currentAssignment = await deps.findCurrentAssignment({
    employeeId: mapping.primaryFsdId,
    companyId,
    dependencies: assignmentDeps(deps),
  });
  let state = DISTRIBUTOR_MAPPING_STATES.MAPPED_VALID;
  if (pathInactive) state = DISTRIBUTOR_MAPPING_STATES.GEOGRAPHY_INACTIVE;
  else if (fsdContext.employee.status !== "active") state = DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_INACTIVE;
  else if (!currentAssignment) state = DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_UNASSIGNED;
  else if (!sameId(currentAssignment.geographyId, mapping.geographyId)) state = DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_GEOGRAPHY_MISMATCH;
  else if (!sameId(account.assignedTo?._id || account.assignedTo, mapping.primaryFsdId)) state = DISTRIBUTOR_MAPPING_STATES.ASSIGNEE_MIRROR_CONFLICT;

  const supervision = await buildSupervisoryOwnership({
    path: pathResult.path,
    primaryFsdContext: fsdContext,
    companyId,
    dependencies: deps,
  });
  const vacancy = supervision.warnings.some((warning) => /_VACANT$/.test(warning));
  if (state === DISTRIBUTOR_MAPPING_STATES.MAPPED_VALID && vacancy) {
    state = DISTRIBUTOR_MAPPING_STATES.SUPERVISORY_VACANCY;
  }
  const requiresReassignment = [
    DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_INACTIVE,
    DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_UNASSIGNED,
    DISTRIBUTOR_MAPPING_STATES.PRIMARY_FSD_GEOGRAPHY_MISMATCH,
    DISTRIBUTOR_MAPPING_STATES.ASSIGNEE_MIRROR_CONFLICT,
  ].includes(state);
  return {
    state,
    requiresReassignment,
    geography: pathResult.path,
    primaryFsd: employeeSummary(fsdContext),
    primaryFsdAssignment: currentAssignment ? {
      id: currentAssignment._id,
      geographyId: currentAssignment.geographyId,
      geographyType: currentAssignment.geographyType,
    } : null,
    supervisoryOwnership: supervision.chain,
    warnings: [...new Set([
      ...supervision.warnings,
      ...(requiresReassignment ? [DISTRIBUTOR_MAPPING_STATES.REASSIGNMENT_REQUIRED] : []),
    ])],
  };
};

const listDistributorMappingReadiness = async ({ user, dependencies = {} }) => {
  const companyId = assertCanManageDistributorMappings(user);
  const deps = depsFor(dependencies);
  const distributorType = await getAccountTypeMaster({
    companyId,
    accountTypeId: (await deps.CrmMaster.findOne({
      companyId,
      module: "account",
      type: "account_type",
      code: "DISTRIBUTOR",
    }))?._id,
    CrmMasterModel: deps.CrmMaster,
  });
  if (!isCanonicalDistributorType(distributorType)) return { summary: { total: 0 }, distributors: [] };
  let accountQuery = deps.Account.find({ companyId, accountTypeId: distributorType._id, deletedAt: null });
  accountQuery = populate(accountQuery, "accountTypeId", "name code module type isActive");
  accountQuery = populate(accountQuery, "assignedTo", "fullName email employeeId status role systemRole reportingManagerId managerId");
  const accounts = await accountQuery;
  const accountIds = accounts.map((item) => item._id);
  const mappings = accountIds.length ? await deps.DistributorMapping.find({
    companyId,
    distributorAccountId: { $in: accountIds },
    isCurrent: true,
    deletedAt: null,
  }) : [];
  const mappingByAccount = new Map(mappings.map((item) => [toId(item.distributorAccountId), item]));
  const rows = [];
  for (const account of accounts) {
    const mapping = mappingByAccount.get(toId(account._id)) || null;
    const health = await evaluateCurrentMapping({ account, mapping, companyId, dependencies: deps });
    rows.push({
      distributor: accountSummary(account),
      mapping: mappingSummary(mapping),
      mappingStatus: health.state,
      ...health,
    });
  }
  rows.sort((first, second) => String(first.distributor.name).localeCompare(String(second.distributor.name)));
  const count = (predicate) => rows.filter(predicate).length;
  return {
    summary: {
      total: rows.length,
      mapped: count((row) => Boolean(row.mapping)),
      unmapped: count((row) => !row.mapping),
      legacyActiveUnmapped: count((row) => row.state === DISTRIBUTOR_MAPPING_STATES.LEGACY_ACTIVE_UNMAPPED),
      issues: count((row) => row.requiresReassignment || row.state === DISTRIBUTOR_MAPPING_STATES.SUPERVISORY_VACANCY),
      existingEligibleAssignee: count((row) => row.existingAssignee?.eligible === true),
      existingInvalidAssignee: count((row) => row.existingAssignee?.eligible === false),
    },
    distributors: rows,
  };
};

const getDistributorMappingDetails = async ({ accountId, user, dependencies = {} }) => {
  const companyId = assertCanManageDistributorMappings(user);
  const deps = depsFor(dependencies);
  const account = await loadDistributorAccount({ accountId, companyId, dependencies: deps });
  const current = await loadCurrentMapping({ accountId, companyId, dependencies: deps });
  const history = await deps.DistributorMapping.find({
    companyId,
    distributorAccountId: accountId,
    deletedAt: null,
  }).sort({ effectiveFrom: -1 });
  const health = await evaluateCurrentMapping({ account, mapping: current, companyId, dependencies: deps });
  return {
    distributor: accountSummary(account),
    current: mappingSummary(current),
    history: history.map(mappingSummary),
    ...health,
  };
};

const assertDistributorAccountMutationAllowed = async ({
  account,
  proposedData = {},
  companyId,
  session = null,
  dependencies = {},
}) => {
  const deps = depsFor(dependencies);
  const currentType = await getAccountTypeMaster({
    companyId,
    accountTypeId: account.accountTypeId,
    session,
    CrmMasterModel: deps.CrmMaster,
  });
  const proposedType = proposedData.accountTypeId !== undefined
    ? await getAccountTypeMaster({
        companyId,
        accountTypeId: proposedData.accountTypeId,
        session,
        CrmMasterModel: deps.CrmMaster,
      })
    : currentType;
  const currentlyDistributor = isCanonicalDistributorType(currentType);
  const willBeDistributor = isCanonicalDistributorType(proposedType);
  const mapping = currentlyDistributor || willBeDistributor
    ? await loadCurrentMapping({ accountId: account._id, companyId, session, dependencies: deps })
    : null;
  if (mapping && !willBeDistributor) {
    throw new ApiError(409, "Mapped Distributor Account Type cannot be changed");
  }
  if (mapping && proposedData.assignedTo !== undefined && !sameId(proposedData.assignedTo, mapping.primaryFsdId)) {
    throw new ApiError(409, "Mapped Distributor ownership cannot be changed through generic Account assignment; use the Phase 5 workflow");
  }
  const resultingAssignee = proposedData.assignedTo !== undefined ? proposedData.assignedTo : account.assignedTo;
  if (mapping && !sameId(resultingAssignee, mapping.primaryFsdId)) {
    throw new ApiError(409, "Mapped Distributor Account assignee is inconsistent with its authoritative Primary FSD");
  }
  if (
    mapping &&
    proposedData.reportingManagerId !== undefined &&
    !sameId(proposedData.reportingManagerId, account.reportingManagerId)
  ) {
    throw new ApiError(409, "Mapped Distributor reporting compatibility cannot be changed through generic Account update");
  }
  const nextStatus = proposedData.status !== undefined ? proposedData.status : account.status;
  const activating = willBeDistributor && nextStatus === "active" && (
    account.status !== "active" || !currentlyDistributor
  );
  if (activating && !mapping) {
    throw new ApiError(409, "Distributor must have a valid Area and Primary FSD mapping before activation");
  }
  if (activating && mapping) {
    const simulated = {
      ...(account.toObject?.() || account),
      ...proposedData,
      accountTypeId: proposedType,
    };
    const health = await evaluateCurrentMapping({ account: simulated, mapping, companyId, dependencies: deps });
    if (![DISTRIBUTOR_MAPPING_STATES.MAPPED_VALID, DISTRIBUTOR_MAPPING_STATES.SUPERVISORY_VACANCY].includes(health.state)) {
      throw new ApiError(409, `Distributor cannot be activated while mapping state is ${health.state}`);
    }
  }
  return { mapping, currentlyDistributor, willBeDistributor };
};

module.exports = {
  assertCanManageDistributorMappings,
  accountSummary,
  mappingSummary,
  employeeSummary,
  loadDistributorAccount,
  loadCurrentMapping,
  validateArea,
  validatePrimaryFsd,
  buildSupervisoryOwnership,
  buildInitialDistributorMappingPreview,
  applyInitialDistributorMapping,
  listEligiblePrimaryFsds,
  evaluateCurrentMapping,
  listDistributorMappingReadiness,
  getDistributorMappingDetails,
  assertDistributorAccountMutationAllowed,
};
