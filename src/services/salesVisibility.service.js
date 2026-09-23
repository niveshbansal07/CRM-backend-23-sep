const User = require("../models/User");
const Designation = require("../models/Designation");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const DistributorSalesAssignment = require("../models/DistributorSalesAssignment");
const Account = require("../models/Account");
const CrmMaster = require("../models/CrmMaster");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const {
  SALES_VISIBILITY_SCOPE,
  SALES_VISIBILITY_STATUS,
  LEVEL_SCOPE,
  LEVEL_GEOGRAPHY,
} = require("../constants/salesVisibility");

const PLATFORM_ROLES = new Set(["super_admin", "company_admin", "sub_admin"]);
const SALES_EMPLOYEE_ROLES = ["sales_head", "sales_manager", "sales_executive", "sales"];
const CHANNEL_CODES = ["DISTRIBUTOR", "DEALER", "RETAILER", "CUSTOMER"];
const EMPTY_ID = "000000000000000000000000";

const toId = (value) => String(value?._id || value?.id || value || "");
const uniqueIds = (values = []) => [...new Set(values.map(toId).filter(Boolean))];
const impossibleFilter = () => ({ _id: EMPTY_ID });
const isCompanyScope = (context) => context?.scopeType === SALES_VISIBILITY_SCOPE.COMPANY_SALES;
const hasReadyScope = (context) => context?.status === SALES_VISIBILITY_STATUS.READY;

const models = (dependencies = {}) => ({
  User: dependencies.User || User,
  Designation: dependencies.Designation || Designation,
  SalesGeography: dependencies.SalesGeography || SalesGeography,
  EmployeeAssignment:
    dependencies.EmployeeAssignment || SalesEmployeeGeographyAssignment,
  DistributorAssignment:
    dependencies.DistributorAssignment || DistributorSalesAssignment,
  Account: dependencies.Account || Account,
  CrmMaster: dependencies.CrmMaster || CrmMaster,
});

const salesRoleFilter = () => ({
  $or: [
    { role: { $in: SALES_EMPLOYEE_ROLES } },
    { systemRole: { $in: SALES_EMPLOYEE_ROLES } },
  ],
});

const execute = async (query, { select = "", lean = true } = {}) => {
  let current = query;
  if (select && current?.select) current = current.select(select);
  if (lean && current?.lean) current = current.lean();
  return current;
};

const andFilters = (...filters) => {
  const usable = filters.filter((filter) => filter && Object.keys(filter).length);
  if (!usable.length) return {};
  if (usable.length === 1) return usable[0];
  return { $and: usable };
};

const loadDesignation = async (user, companyId, DesignationModel) => {
  const populated = user?.designationId;
  if (populated && typeof populated === "object" && populated.hierarchyLevel) return populated;
  const designationId = toId(populated);
  if (!designationId) return null;
  return execute(
    DesignationModel.findOne({
      _id: designationId,
      companyId,
      status: "active",
      isArchived: { $ne: true },
      deletedAt: null,
    }),
    { select: "_id hierarchyLevel mappedRole code title name status isArchived" }
  );
};

const deriveDescendants = (geographies, root) => {
  const byParent = new Map();
  for (const geography of geographies) {
    const key = toId(geography.parentId);
    const children = byParent.get(key) || [];
    children.push(geography);
    byParent.set(key, children);
  }

  const all = [];
  const queue = [root];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    const currentId = toId(current);
    if (!currentId || visited.has(currentId)) continue;
    visited.add(currentId);
    all.push(current);
    queue.push(...(byParent.get(currentId) || []));
  }

  const idsFor = (type) => uniqueIds(all.filter((item) => item.type === type).map((item) => item._id));
  return {
    allGeographyIds: uniqueIds(all.map((item) => item._id)),
    descendantAreaIds: idsFor("AREA"),
    descendantBranchIds: idsFor("BRANCH"),
    descendantRegionIds: idsFor("REGION"),
    descendantZoneIds: idsFor("ZONE"),
  };
};

const emptyContext = ({ companyId, user, role, status }) => ({
  companyId: toId(companyId),
  employeeId: toId(user?._id),
  hierarchyLevel: null,
  technicalRole: role,
  geographyAssignment: null,
  geographyType: null,
  geographyId: null,
  geographyName: null,
  descendantAreaIds: [],
  descendantBranchIds: [],
  descendantRegionIds: [],
  descendantZoneIds: [],
  allGeographyIds: [],
  accessibleEmployeeIds: [],
  scopeType: SALES_VISIBILITY_SCOPE.NONE,
  status,
  isPlatformAdmin: PLATFORM_ROLES.has(role),
});

const buildSalesVisibilityContext = async ({ user, companyId, dependencies = {} } = {}) => {
  if (!companyId || !user?._id) throw new ApiError(400, "Sales visibility requires company and employee context");
  const actorCompanyId = toId(user.companyId);
  if (actorCompanyId && actorCompanyId !== toId(companyId) && getAccessRole(user) !== "super_admin") {
    throw new ApiError(403, "Company context does not match authenticated employee");
  }

  const role = getAccessRole(user);
  const db = models(dependencies);
  if (PLATFORM_ROLES.has(role) || role === "sales_head") {
    const employees = await execute(
      db.User.find({
        companyId,
        ...salesRoleFilter(),
        status: "active",
        deletedAt: null,
      }),
      { select: "_id" }
    );
    return {
      ...emptyContext({ companyId, user, role, status: SALES_VISIBILITY_STATUS.READY }),
      hierarchyLevel: role === "sales_head" ? 6 : null,
      accessibleEmployeeIds: uniqueIds([user._id, ...(employees || []).map((item) => item._id)]),
      scopeType: SALES_VISIBILITY_SCOPE.COMPANY_SALES,
      isPlatformAdmin: PLATFORM_ROLES.has(role),
    };
  }

  if (!["sales_manager", "sales_executive"].includes(role)) {
    return emptyContext({
      companyId,
      user,
      role,
      status: SALES_VISIBILITY_STATUS.NOT_SALES_AUTHORITY,
    });
  }

  const designation = await loadDesignation(user, companyId, db.Designation);
  const hierarchyLevel = Number(designation?.hierarchyLevel || 0);
  const validLevel = role === "sales_manager"
    ? hierarchyLevel >= 2 && hierarchyLevel <= 5
    : hierarchyLevel === 1;
  const expectedRole = hierarchyLevel === 1 ? "sales_executive" : "sales_manager";
  if (
    !validLevel ||
    designation?.status === "inactive" ||
    designation?.isArchived === true ||
    (designation?.mappedRole && designation.mappedRole !== expectedRole)
  ) {
    return emptyContext({
      companyId,
      user,
      role,
      status: SALES_VISIBILITY_STATUS.AMBIGUOUS_SALES_DESIGNATION,
    });
  }

  const assignment = await execute(
    db.EmployeeAssignment.findOne({
      companyId,
      employeeId: user._id,
      assignmentType: "PRIMARY",
      status: "current",
      isCurrent: true,
      deletedAt: null,
    }),
    { select: "_id employeeId hierarchyLevel geographyId geographyType isResponsibleManager effectiveFrom" }
  );
  if (!assignment) {
    const noAssignment = emptyContext({
      companyId,
      user,
      role,
      status: SALES_VISIBILITY_STATUS.NO_ACTIVE_SALES_GEOGRAPHY,
    });
    noAssignment.hierarchyLevel = hierarchyLevel;
    if (hierarchyLevel === 1) {
      noAssignment.scopeType = SALES_VISIBILITY_SCOPE.OWN_ASSIGNED;
      noAssignment.accessibleEmployeeIds = [toId(user._id)];
    }
    return noAssignment;
  }

  const expectedType = LEVEL_GEOGRAPHY[hierarchyLevel];
  if (
    Number(assignment.hierarchyLevel) !== hierarchyLevel ||
    assignment.geographyType !== expectedType
  ) {
    const invalid = emptyContext({
      companyId,
      user,
      role,
      status: SALES_VISIBILITY_STATUS.INVALID_SALES_GEOGRAPHY,
    });
    invalid.hierarchyLevel = hierarchyLevel;
    return invalid;
  }

  const geographies = await execute(
    db.SalesGeography.find({
      companyId,
      status: "active",
      isActive: true,
      isArchived: { $ne: true },
      deletedAt: null,
    }),
    { select: "_id type name code parentId" }
  );
  const root = (geographies || []).find((item) => toId(item._id) === toId(assignment.geographyId));
  if (!root || root.type !== expectedType) {
    const invalid = emptyContext({
      companyId,
      user,
      role,
      status: SALES_VISIBILITY_STATUS.INVALID_SALES_GEOGRAPHY,
    });
    invalid.hierarchyLevel = hierarchyLevel;
    return invalid;
  }

  const descendants = deriveDescendants(geographies, root);
  let accessibleEmployeeIds = [toId(user._id)];
  if (hierarchyLevel > 1) {
    const employeeAssignments = await execute(
      db.EmployeeAssignment.find({
        companyId,
        geographyId: { $in: descendants.allGeographyIds },
        status: "current",
        isCurrent: true,
        deletedAt: null,
      }),
      { select: "employeeId" }
    );
    const candidateIds = uniqueIds([user._id, ...(employeeAssignments || []).map((item) => item.employeeId)]);
    const employees = candidateIds.length
      ? await execute(
        db.User.find({
          _id: { $in: candidateIds },
          companyId,
          ...salesRoleFilter(),
          status: "active",
          deletedAt: null,
        }),
        { select: "_id" }
      )
      : [];
    accessibleEmployeeIds = uniqueIds([user._id, ...(employees || []).map((item) => item._id)]);
  }

  return {
    companyId: toId(companyId),
    employeeId: toId(user._id),
    hierarchyLevel,
    technicalRole: role,
    geographyAssignment: assignment,
    geographyType: root.type,
    geographyId: toId(root._id),
    geographyName: root.name || "",
    ...descendants,
    accessibleEmployeeIds,
    scopeType: LEVEL_SCOPE[hierarchyLevel],
    status: SALES_VISIBILITY_STATUS.READY,
    isPlatformAdmin: false,
  };
};

// Authentication loads a fresh User document per request. WeakMap caching is
// therefore request-local in practice, avoids repeated Geography resolution in
// nested service calls, and cannot survive employee/distributor transfer into a
// later request.
const visibilityContextCache = new WeakMap();
const resolveSalesVisibilityContext = async (input = {}) => {
  const { user, companyId, dependencies = {} } = input;
  if (!user || typeof user !== "object" || Object.keys(dependencies).length) {
    return buildSalesVisibilityContext(input);
  }
  const key = toId(companyId);
  let byCompany = visibilityContextCache.get(user);
  if (!byCompany) {
    byCompany = new Map();
    visibilityContextCache.set(user, byCompany);
  }
  if (!byCompany.has(key)) {
    const pending = buildSalesVisibilityContext(input).catch((error) => {
      byCompany.delete(key);
      throw error;
    });
    byCompany.set(key, pending);
  }
  return byCompany.get(key);
};

const requestedEmployeeFilter = (context, requestedId) => {
  if (!requestedId) return {};
  const id = requestedId === "me" ? context.employeeId : toId(requestedId);
  return context.accessibleEmployeeIds.includes(id) ? { assignedTo: id } : impossibleFilter();
};

const buildLeadVisibilityFilter = (context, filters = {}) => {
  if (!context || (!hasReadyScope(context) && context.hierarchyLevel !== 1)) return impossibleFilter();
  let scope = {};
  if (!isCompanyScope(context)) {
    scope = context.hierarchyLevel === 1
      ? { $or: [{ assignedTo: context.employeeId }, { createdBy: context.employeeId }] }
      : { $or: [{ assignedTo: { $in: context.accessibleEmployeeIds } }, { createdBy: context.employeeId }] };
  }
  return andFilters(scope, requestedEmployeeFilter(context, filters.assignedTo));
};

const buildOrderVisibilityFilter = (context, { accountIds = [], assignedTo = null } = {}) => {
  if (!context || (!hasReadyScope(context) && context.hierarchyLevel !== 1)) return impossibleFilter();
  let scope = {};
  if (!isCompanyScope(context)) {
    const employeeIds = context.hierarchyLevel === 1 ? [context.employeeId] : context.accessibleEmployeeIds;
    const alternatives = [
      { assignedTo: { $in: employeeIds } },
      { createdBy: context.employeeId },
    ];
    if (context.hierarchyLevel > 1 && accountIds.length) {
      alternatives.push({ assignedTo: null, accountId: { $in: accountIds } });
    }
    scope = { $or: alternatives };
  }
  return andFilters(scope, requestedEmployeeFilter(context, assignedTo));
};

const buildVisitVisibilityFilter = (context, requestedExecutiveId = null) => {
  if (!context || (!hasReadyScope(context) && context.hierarchyLevel !== 1)) return impossibleFilter();
  const employeeIds = isCompanyScope(context)
    ? context.accessibleEmployeeIds
    : context.hierarchyLevel === 1
      ? [context.employeeId]
      : context.accessibleEmployeeIds;
  const scope = isCompanyScope(context) ? {} : { executiveId: { $in: employeeIds } };
  if (!requestedExecutiveId) return scope;
  const requested = requestedExecutiveId === "me" ? context.employeeId : toId(requestedExecutiveId);
  return employeeIds.includes(requested)
    ? andFilters(scope, { executiveId: requested })
    : impossibleFilter();
};

const buildFollowUpVisibilityFilter = (context, requestedEmployeeId = null) => {
  if (!context || (!hasReadyScope(context) && context.hierarchyLevel !== 1)) return impossibleFilter();
  const employeeIds = isCompanyScope(context)
    ? context.accessibleEmployeeIds
    : context.hierarchyLevel === 1
      ? [context.employeeId]
      : context.accessibleEmployeeIds;
  const scope = isCompanyScope(context) ? {} : { assignedTo: { $in: employeeIds } };
  if (!requestedEmployeeId) return scope;
  const requested = requestedEmployeeId === "me" ? context.employeeId : toId(requestedEmployeeId);
  return employeeIds.includes(requested)
    ? andFilters(scope, { assignedTo: requested })
    : impossibleFilter();
};

const loadChannelMasters = async (companyId, CrmMasterModel) => {
  const rows = await execute(
    CrmMasterModel.find({
      companyId,
      module: "account",
      type: "account_type",
      code: { $in: CHANNEL_CODES },
      isActive: true,
    }),
    { select: "_id code" }
  );
  const byCode = Object.fromEntries((rows || []).map((row) => [String(row.code).toUpperCase(), toId(row._id)]));
  return { rows: rows || [], byCode, ids: uniqueIds((rows || []).map((row) => row._id)) };
};

const buildAccessibleAccountScope = async (context, { dependencies = {} } = {}) => {
  if (!context || (!hasReadyScope(context) && context.hierarchyLevel !== 1)) {
    return { filter: impossibleFilter(), accountIds: [], distributorIds: [], channelAccountIds: [] };
  }
  if (isCompanyScope(context)) {
    return { filter: {}, accountIds: [], distributorIds: [], channelAccountIds: [], companyWide: true };
  }

  const db = models(dependencies);
  const masters = await loadChannelMasters(context.companyId, db.CrmMaster);
  const mappingQuery = {
    companyId: context.companyId,
    isCurrent: true,
    status: "current",
    deletedAt: null,
  };
  if (context.hierarchyLevel === 1) mappingQuery.primaryFsdId = context.employeeId;
  else mappingQuery.geographyId = { $in: context.descendantAreaIds };

  const mappings = await execute(db.DistributorAssignment.find(mappingQuery), {
    select: "distributorAccountId geographyId primaryFsdId",
  });
  const distributorIds = uniqueIds((mappings || []).map((item) => item.distributorAccountId));
  const parentTypes = [masters.byCode.DEALER, masters.byCode.RETAILER].filter(Boolean);
  const channelParents = distributorIds.length && parentTypes.length
    ? await execute(db.Account.find({
      companyId: context.companyId,
      accountTypeId: { $in: parentTypes },
      parentAccountId: { $in: distributorIds },
      deletedAt: null,
    }), { select: "_id" })
    : [];
  const channelParentIds = uniqueIds((channelParents || []).map((item) => item._id));
  const customerParents = uniqueIds([...distributorIds, ...channelParentIds]);
  const customers = customerParents.length && masters.byCode.CUSTOMER
    ? await execute(db.Account.find({
      companyId: context.companyId,
      accountTypeId: masters.byCode.CUSTOMER,
      parentAccountId: { $in: customerParents },
      deletedAt: null,
    }), { select: "_id" })
    : [];
  const governedIds = uniqueIds([
    ...distributorIds,
    ...channelParentIds,
    ...(customers || []).map((item) => item._id),
  ]);

  // Transitional compatibility: directly owned channel records are added only
  // when they cannot resolve to any current Distributor mapping. A valid
  // out-of-scope mapping always wins over stale Account.assignedTo.
  const directlyOwned = masters.ids.length
    ? await execute(db.Account.find({
      companyId: context.companyId,
      accountTypeId: { $in: masters.ids },
      assignedTo: { $in: context.accessibleEmployeeIds },
      deletedAt: null,
    }), { select: "_id accountTypeId parentAccountId" })
    : [];
  const parentIds = uniqueIds((directlyOwned || []).map((item) => item.parentAccountId));
  const parents = parentIds.length
    ? await execute(db.Account.find({
      _id: { $in: parentIds }, companyId: context.companyId, deletedAt: null,
    }), { select: "_id accountTypeId parentAccountId" })
    : [];
  const grandparentIds = uniqueIds((parents || []).map((item) => item.parentAccountId));
  const grandparents = grandparentIds.length
    ? await execute(db.Account.find({
      _id: { $in: grandparentIds }, companyId: context.companyId, deletedAt: null,
    }), { select: "_id accountTypeId parentAccountId" })
    : [];
  const lookup = new Map([...directlyOwned, ...parents, ...grandparents].map((item) => [toId(item._id), item]));
  const rootDistributorId = (account) => {
    let current = account;
    for (let depth = 0; depth < 3 && current; depth += 1) {
      if (toId(current.accountTypeId) === masters.byCode.DISTRIBUTOR) return toId(current._id);
      current = lookup.get(toId(current.parentAccountId));
    }
    return "";
  };
  const roots = uniqueIds((directlyOwned || []).map(rootDistributorId));
  const currentRootMappings = roots.length
    ? await execute(db.DistributorAssignment.find({
      companyId: context.companyId,
      distributorAccountId: { $in: roots },
      isCurrent: true,
      status: "current",
      deletedAt: null,
    }), { select: "distributorAccountId" })
    : [];
  const mappedRoots = new Set((currentRootMappings || []).map((item) => toId(item.distributorAccountId)));
  const unresolvedOwnedIds = uniqueIds((directlyOwned || [])
    .filter((item) => {
      const root = rootDistributorId(item);
      return !root || !mappedRoots.has(root);
    })
    .map((item) => item._id));
  const channelAccountIds = uniqueIds([...governedIds, ...unresolvedOwnedIds]);

  const ownership = context.accessibleEmployeeIds.length
    ? {
      accountTypeId: { $nin: masters.ids },
      $or: [
        { assignedTo: { $in: context.accessibleEmployeeIds } },
        { createdBy: context.employeeId },
      ],
    }
    : impossibleFilter();
  const ownedNonChannel = context.accessibleEmployeeIds.length
    ? await execute(db.Account.find(andFilters(
      { companyId: context.companyId, deletedAt: null },
      ownership
    )), { select: "_id" })
    : [];
  const alternatives = [ownership];
  if (channelAccountIds.length) alternatives.unshift({ _id: { $in: channelAccountIds } });
  return {
    filter: { $or: alternatives },
    accountIds: uniqueIds([...channelAccountIds, ...(ownedNonChannel || []).map((item) => item._id)]),
    distributorIds,
    channelAccountIds,
    unresolvedOwnedIds,
    channelTypeIds: masters.ids,
  };
};

const accountScopeCache = new WeakMap();
const resolveAccessibleAccountScope = async (context, options = {}) => {
  const dependencies = options.dependencies || {};
  if (!context || typeof context !== "object" || Object.keys(dependencies).length) {
    return buildAccessibleAccountScope(context, options);
  }
  if (!accountScopeCache.has(context)) {
    const pending = buildAccessibleAccountScope(context, options).catch((error) => {
      accountScopeCache.delete(context);
      throw error;
    });
    accountScopeCache.set(context, pending);
  }
  return accountScopeCache.get(context);
};

const assertEmployeeWithinVisibility = async ({ context, employeeId, companyId, dependencies = {} }) => {
  const targetId = toId(employeeId);
  if (!targetId || !context?.accessibleEmployeeIds.includes(targetId)) {
    throw new ApiError(403, "Selected employee is outside your Sales visibility scope");
  }
  const db = models(dependencies);
  const employee = await execute(db.User.findOne({
    _id: targetId,
    companyId,
    $or: [
      { role: { $in: ["sales_executive", "sales"] } },
      { systemRole: { $in: ["sales_executive", "sales"] } },
    ],
    status: "active",
    deletedAt: null,
  }), { select: "_id fullName email role reportingManagerId" });
  if (!employee) throw new ApiError(400, "Assignee must be an active sales executive");
  return employee;
};

const assertAccountWithinVisibility = async ({ context, accountId, companyId, dependencies = {} }) => {
  const db = models(dependencies);
  const scope = await resolveAccessibleAccountScope(context, { dependencies });
  const account = await execute(db.Account.findOne(andFilters(
    { _id: accountId, companyId, deletedAt: null },
    scope.filter
  )), { select: "_id accountTypeId parentAccountId assignedTo" });
  if (!account) throw new ApiError(404, "Account not found");
  return account;
};

module.exports = {
  SALES_VISIBILITY_SCOPE,
  SALES_VISIBILITY_STATUS,
  EMPTY_ID,
  toId,
  uniqueIds,
  andFilters,
  impossibleFilter,
  isCompanyScope,
  hasReadyScope,
  deriveDescendants,
  resolveSalesVisibilityContext,
  buildLeadVisibilityFilter,
  buildOrderVisibilityFilter,
  buildVisitVisibilityFilter,
  buildFollowUpVisibilityFilter,
  resolveAccessibleAccountScope,
  assertEmployeeWithinVisibility,
  assertAccountWithinVisibility,
};
