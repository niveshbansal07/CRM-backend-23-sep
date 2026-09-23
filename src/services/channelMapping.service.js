const mongoose = require("mongoose");
const Account = require("../models/Account");
const CrmMaster = require("../models/CrmMaster");
const DistributorSalesAssignment = require("../models/DistributorSalesAssignment");
const AuditLog = require("../models/AuditLog");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const { getAccountTypeMaster } = require("./distributorAccount.service");
const {
  loadDistributorAccount,
  loadCurrentMapping,
  evaluateCurrentMapping,
  accountSummary: distributorAccountSummary,
  mappingSummary,
} = require("./distributorSalesMapping.service");
const { writeAuditLog } = require("./auditLog.service");
const { DISTRIBUTOR_MAPPING_STATES } = require("../constants/distributorSalesMapping");
const {
  CHANNEL_MAPPING_MANAGE_ROLES,
  CHANNEL_MAPPING_READ_ROLES,
  CHANNEL_ACCOUNT_TYPES,
  CHANNEL_READINESS_STATES,
} = require("../constants/channelMapping");
const {
  resolveSalesVisibilityContext,
  assertAccountWithinVisibility,
} = require("./salesVisibility.service");

const DEFAULT_DEPS = {
  Account,
  CrmMaster,
  DistributorMapping: DistributorSalesAssignment,
  AuditLog,
  getAccountTypeMaster,
  loadDistributorAccount,
  loadCurrentMapping,
  evaluateCurrentMapping,
  writeAuditLog,
  startSession: () => mongoose.startSession(),
  newOperationId: () => new mongoose.Types.ObjectId(),
};

const depsFor = (dependencies = {}) => ({ ...DEFAULT_DEPS, ...dependencies });
const toId = (value) => String(value?._id || value?.id || value || "");
const sameId = (left, right) => Boolean(toId(left)) && toId(left) === toId(right);
const withSession = (query, session) => session && query?.session ? query.session(session) : query;
const populate = (query, path, select) => query?.populate ? query.populate(path, select) : query;
const cleanText = (value) => String(value || "").trim().replace(/\s+/g, " ");
const typeCode = (master) => String(master?.code || "").trim().toUpperCase();
const GOVERNED_TYPES = new Set(Object.values(CHANNEL_ACCOUNT_TYPES));
const OPERATIONAL_CHILD_STATUSES = new Set(["active", "partner", "customer"]);
const ELIGIBLE_DISTRIBUTOR_HEALTH = new Set([
  DISTRIBUTOR_MAPPING_STATES.MAPPED_VALID,
  DISTRIBUTOR_MAPPING_STATES.SUPERVISORY_VACANCY,
]);

const requireReason = (value) => {
  const reason = cleanText(value);
  if (reason.length < 2) throw new ApiError(400, "Channel mapping reason is required");
  if (reason.length > 500) throw new ApiError(400, "Channel mapping reason must be 500 characters or less");
  return reason;
};

const assertCanManageChannelMappings = (user) => {
  const role = getAccessRole(user);
  if (!CHANNEL_MAPPING_MANAGE_ROLES.includes(role)) {
    throw new ApiError(403, "Only Head of Sales and platform administrators can manage channel mappings");
  }
  const companyId = user?.companyId?._id || user?.companyId;
  if (!companyId) throw new ApiError(400, "Company context is required");
  return { companyId, role };
};

const assertCanReadChannelHierarchy = (user) => {
  const role = getAccessRole(user);
  if (!CHANNEL_MAPPING_READ_ROLES.includes(role)) {
    throw new ApiError(403, "Sales channel hierarchy access denied");
  }
  const companyId = user?.companyId?._id || user?.companyId;
  if (!companyId) throw new ApiError(400, "Company context is required");
  return { companyId, role };
};

const accountSummary = (account, canonicalType = null) => account ? ({
  id: account._id,
  name: account.name || "",
  status: account.status || "",
  city: account.city || "",
  distributorBusinessId: account.distributorBusinessId || null,
  accountType: canonicalType || typeCode(account.accountTypeId) || String(account.accountType || "").toUpperCase(),
  parentAccountId: account.parentAccountId?._id || account.parentAccountId || null,
  parentRelationshipType: account.parentRelationshipType || null,
  assignedTo: account.assignedTo ? {
    id: account.assignedTo._id || account.assignedTo,
    fullName: account.assignedTo.fullName || "",
  } : null,
}) : null;

const resolveCanonicalType = async ({ account, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const master = await deps.getAccountTypeMaster({
    companyId,
    accountTypeId: account?.accountTypeId,
    session,
    CrmMasterModel: deps.CrmMaster,
  });
  const code = typeCode(master);
  const canonical = String(master?.module || "").toLowerCase() === "account" &&
    String(master?.type || "").toLowerCase() === "account_type";
  if (!canonical || !GOVERNED_TYPES.has(code) || master?.isActive === false) return { code: null, master };
  return { code, master };
};

const loadAccount = async ({ accountId, companyId = null, session = null, scoped = true, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const filter = { _id: accountId, deletedAt: null, ...(scoped ? { companyId } : {}) };
  let query = deps.Account.findOne(filter);
  query = populate(query, "accountTypeId", "name code module type isActive");
  query = populate(query, "assignedTo", "fullName employeeId status");
  return withSession(query, session);
};

const expectedParentTypes = (childType) => {
  if ([CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER].includes(childType)) {
    return [CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR];
  }
  if (childType === CHANNEL_ACCOUNT_TYPES.CUSTOMER) {
    return [CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER];
  }
  return [];
};

const assertNoParentCycle = async ({ childAccountId, parentAccountId, companyId, session = null, dependencies = {} }) => {
  if (!parentAccountId || !childAccountId) return;
  if (sameId(childAccountId, parentAccountId)) throw new ApiError(409, "Account cannot be its own parent");
  const deps = depsFor(dependencies);
  const visited = new Set([toId(childAccountId)]);
  let cursor = parentAccountId;
  for (let depth = 0; cursor && depth < 50; depth += 1) {
    const cursorId = toId(cursor);
    if (visited.has(cursorId)) throw new ApiError(409, "Account parent relationship would create a cycle");
    visited.add(cursorId);
    const parent = await withSession(deps.Account.findOne({ _id: cursor, companyId, deletedAt: null }), session);
    if (!parent) return;
    cursor = parent.parentAccountId;
  }
  if (cursor) throw new ApiError(409, "Account parent hierarchy exceeds the supported integrity depth");
};

const validateInitialParent = async ({
  companyId,
  accountTypeId,
  parentAccountId,
  parentRelationshipType,
  childAccountId = null,
  allowLegacyDirectDistributorCustomer = false,
  session = null,
  dependencies = {},
}) => {
  const deps = depsFor(dependencies);
  const childTypeResult = await resolveCanonicalType({
    account: { accountTypeId }, companyId, session, dependencies: deps,
  });
  const childType = childTypeResult.code;
  if (!childType) return { governed: false, parentAccountId, parentRelationshipType };
  if (childType === CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR) {
    if (parentAccountId) throw new ApiError(409, "Distributor must remain a root channel Account");
    return { governed: true, childType, parentAccountId: null, parentRelationshipType: null };
  }
  if (!parentAccountId) {
    if (parentRelationshipType) throw new ApiError(400, "Parent relationship type requires a parent Account");
    return { governed: true, childType, parentAccountId: null, parentRelationshipType: null };
  }
  const parent = await loadAccount({ accountId: parentAccountId, companyId, session, dependencies: deps });
  if (!parent) throw new ApiError(404, "Eligible parent Account not found");
  const parentType = (await resolveCanonicalType({ account: parent, companyId, session, dependencies: deps })).code;
  const allowed = expectedParentTypes(childType);
  const legacyDirect = childType === CHANNEL_ACCOUNT_TYPES.CUSTOMER &&
    parentType === CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR && allowLegacyDirectDistributorCustomer;
  if (!allowed.includes(parentType) && !legacyDirect) {
    throw new ApiError(409, `${childType} cannot be mapped under ${parentType || "this Account type"}`);
  }
  await assertNoParentCycle({ childAccountId, parentAccountId, companyId, session, dependencies: deps });
  return {
    governed: true,
    childType,
    parentType,
    parent,
    parentAccountId: parent._id,
    parentRelationshipType: parentType.toLowerCase(),
    legacyDirect,
  };
};

const assertChannelParentMutationAllowed = async ({ account, proposedData = {}, companyId, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const currentType = (await resolveCanonicalType({ account, companyId, dependencies: deps })).code;
  const proposedType = proposedData.accountTypeId !== undefined
    ? (await resolveCanonicalType({ account: { accountTypeId: proposedData.accountTypeId }, companyId, dependencies: deps })).code
    : currentType;
  if (!currentType && !proposedType) return;
  const parentAuthored = proposedData.parentAccountId !== undefined || proposedData.parentRelationshipType !== undefined;
  if (!parentAuthored && proposedData.accountTypeId === undefined) return;
  const currentParentId = account.parentAccountId?._id || account.parentAccountId || null;
  const nextParentId = proposedData.parentAccountId !== undefined ? proposedData.parentAccountId : currentParentId;
  const nextRelationship = proposedData.parentRelationshipType !== undefined
    ? proposedData.parentRelationshipType
    : account.parentRelationshipType;
  const parentUnchanged = (!currentParentId && !nextParentId) || sameId(currentParentId, nextParentId);
  const relationshipUnchanged = String(account.parentRelationshipType || "") === String(nextRelationship || "");
  const typeUnchanged = proposedData.accountTypeId === undefined || sameId(proposedData.accountTypeId, account.accountTypeId);
  if (parentUnchanged && relationshipUnchanged && typeUnchanged) return;
  if (!currentParentId && !nextParentId && !nextRelationship) return;
  throw new ApiError(409, "Governed Dealer/Retailer/Customer parent relationships cannot be changed through generic Account update; use Channel Mapping");
};

const loadDistributorOwnership = async ({ distributorAccountId, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const distributor = await deps.loadDistributorAccount({
    accountId: distributorAccountId,
    companyId,
    session,
    dependencies: deps,
  });
  const mapping = await deps.loadCurrentMapping({ accountId: distributor._id, companyId, session, dependencies: deps });
  const health = await deps.evaluateCurrentMapping({ account: distributor, mapping, companyId, dependencies: deps });
  const eligible = distributor.status === "active" && Boolean(mapping) && ELIGIBLE_DISTRIBUTOR_HEALTH.has(health.state);
  return { distributor, mapping, health, eligible };
};

const unavailableParentState = (account) => OPERATIONAL_CHILD_STATUSES.has(account.status)
  ? CHANNEL_READINESS_STATES.LEGACY_ACTIVE_UNMAPPED
  : CHANNEL_READINESS_STATES.READY_FOR_MAPPING;

const deriveChannelHierarchy = async ({ account, companyId, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const childType = (await resolveCanonicalType({ account, companyId, session, dependencies: deps })).code;
  if (![CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER, CHANNEL_ACCOUNT_TYPES.CUSTOMER].includes(childType)) {
    throw new ApiError(400, "Account must be a canonical Dealer, Retailer, or Customer");
  }
  const result = {
    account: accountSummary(account, childType),
    accountType: childType,
    state: unavailableParentState(account),
    warnings: [],
    blockers: [],
    channelParent: null,
    distributor: null,
    distributorMapping: null,
    distributorHealth: null,
    geography: null,
    primaryFsd: null,
    supervisoryOwnership: null,
  };
  if (!account.parentAccountId) return result;
  const unscopedParent = await loadAccount({
    accountId: account.parentAccountId?._id || account.parentAccountId,
    companyId,
    session,
    scoped: false,
    dependencies: deps,
  });
  if (!unscopedParent) {
    result.state = CHANNEL_READINESS_STATES.PARENT_MISSING;
    result.blockers.push(CHANNEL_READINESS_STATES.PARENT_MISSING);
    return result;
  }
  if (!sameId(unscopedParent.companyId, companyId)) {
    result.state = CHANNEL_READINESS_STATES.CROSS_COMPANY_PARENT;
    result.blockers.push(CHANNEL_READINESS_STATES.CROSS_COMPANY_PARENT);
    return result;
  }
  const parentType = (await resolveCanonicalType({ account: unscopedParent, companyId, session, dependencies: deps })).code;
  result.channelParent = accountSummary(unscopedParent, parentType);
  let distributor = null;
  if ([CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER].includes(childType)) {
    if (parentType !== CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR) {
      result.state = CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE;
      result.blockers.push(CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE);
      return result;
    }
    distributor = unscopedParent;
  } else if ([CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER].includes(parentType)) {
    if (!OPERATIONAL_CHILD_STATUSES.has(unscopedParent.status)) {
      result.state = CHANNEL_READINESS_STATES.CHANNEL_PARENT_INACTIVE;
      result.warnings.push(result.state);
      return result;
    }
    if (String(unscopedParent.parentRelationshipType || "") !== "distributor") {
      result.state = CHANNEL_READINESS_STATES.INVALID_RELATIONSHIP_TYPE;
      result.warnings.push(result.state);
      return result;
    }
    if (!unscopedParent.parentAccountId) {
      result.state = unavailableParentState(unscopedParent);
      result.warnings.push(result.state);
      return result;
    }
    const parentDistributor = await loadAccount({
      accountId: unscopedParent.parentAccountId?._id || unscopedParent.parentAccountId,
      companyId,
      session,
      dependencies: deps,
    });
    if (!parentDistributor) {
      result.state = CHANNEL_READINESS_STATES.PARENT_MISSING;
      result.blockers.push(CHANNEL_READINESS_STATES.PARENT_MISSING);
      return result;
    }
    const distributorType = (await resolveCanonicalType({ account: parentDistributor, companyId, session, dependencies: deps })).code;
    if (distributorType !== CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR) {
      result.state = CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE;
      result.blockers.push(CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE);
      return result;
    }
    distributor = parentDistributor;
  } else if (parentType === CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR) {
    result.state = CHANNEL_READINESS_STATES.LEGACY_DIRECT_DISTRIBUTOR_CUSTOMER;
    result.warnings.push(CHANNEL_READINESS_STATES.LEGACY_DIRECT_DISTRIBUTOR_CUSTOMER);
    distributor = unscopedParent;
  } else {
    result.state = CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE;
    result.blockers.push(CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE);
    return result;
  }
  if (!distributor) return result;
  let ownership;
  try {
    ownership = await loadDistributorOwnership({ distributorAccountId: distributor._id, companyId, session, dependencies: deps });
  } catch (error) {
    if (![400, 404, 409].includes(error.statusCode)) throw error;
    result.state = CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE;
    result.blockers.push(CHANNEL_READINESS_STATES.INVALID_PARENT_TYPE);
    return result;
  }
  result.distributor = distributorAccountSummary(ownership.distributor);
  result.distributorMapping = mappingSummary(ownership.mapping);
  result.distributorHealth = ownership.health;
  result.geography = ownership.health.geography || null;
  result.primaryFsd = ownership.health.primaryFsd || null;
  result.supervisoryOwnership = ownership.health.supervisoryOwnership || null;
  if (ownership.distributor.status !== "active") {
    result.state = CHANNEL_READINESS_STATES.PARENT_DISTRIBUTOR_INACTIVE;
    result.warnings.push(result.state);
  } else if (!ownership.mapping) {
    result.state = CHANNEL_READINESS_STATES.PARENT_DISTRIBUTOR_UNMAPPED;
    result.warnings.push(result.state);
  } else if (ownership.health.requiresReassignment || !ELIGIBLE_DISTRIBUTOR_HEALTH.has(ownership.health.state)) {
    result.state = CHANNEL_READINESS_STATES.PARENT_DISTRIBUTOR_REASSIGNMENT_REQUIRED;
    result.warnings.push(result.state);
  } else if (result.state !== CHANNEL_READINESS_STATES.LEGACY_DIRECT_DISTRIBUTOR_CUSTOMER) {
    const expectedRelationship = childType === CHANNEL_ACCOUNT_TYPES.CUSTOMER
      ? parentType.toLowerCase()
      : "distributor";
    if (String(account.parentRelationshipType || "") !== expectedRelationship) {
      result.state = CHANNEL_READINESS_STATES.INVALID_RELATIONSHIP_TYPE;
      result.warnings.push(result.state);
    } else {
      result.state = CHANNEL_READINESS_STATES.MAPPED_VALID;
    }
  }
  return result;
};

const buildChannelMappingPreview = async ({ payload, user, session = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertCanManageChannelMappings(user);
  const reason = requireReason(payload?.reason);
  const isCustomerMapping = Boolean(payload?.customerAccountId);
  const childId = isCustomerMapping ? payload.customerAccountId : payload.childAccountId;
  const proposedParentId = isCustomerMapping ? payload.parentAccountId : payload.distributorAccountId;
  const child = await loadAccount({ accountId: childId, companyId, session, dependencies: deps });
  if (!child) throw new ApiError(404, "Channel child Account not found");
  const childType = (await resolveCanonicalType({ account: child, companyId, session, dependencies: deps })).code;
  const permitted = isCustomerMapping
    ? [CHANNEL_ACCOUNT_TYPES.CUSTOMER]
    : [CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER];
  if (!permitted.includes(childType)) throw new ApiError(400, `Account must be a canonical ${permitted.join(" or ")}`);
  const current = await deriveChannelHierarchy({ account: child, companyId, session, dependencies: deps });
  const validation = await validateInitialParent({
    companyId,
    accountTypeId: child.accountTypeId,
    parentAccountId: proposedParentId,
    parentRelationshipType: null,
    childAccountId: child._id,
    allowLegacyDirectDistributorCustomer: false,
    session,
    dependencies: deps,
  });
  const blockers = [];
  const warnings = [];
  const currentParentId = child.parentAccountId?._id || child.parentAccountId || null;
  const idempotent = Boolean(currentParentId && sameId(currentParentId, validation.parent._id) &&
    String(child.parentRelationshipType || "") === validation.parentRelationshipType);
  if (currentParentId && !sameId(currentParentId, validation.parent._id)) blockers.push("EXISTING_PARENT_REPLACEMENT_DEFERRED");
  let proposedHierarchy;
  if (isCustomerMapping) {
    proposedHierarchy = await deriveChannelHierarchy({
      account: { ...(child.toObject?.() || child), parentAccountId: validation.parent._id, parentRelationshipType: validation.parentRelationshipType },
      companyId,
      session,
      dependencies: deps,
    });
    if (proposedHierarchy.state !== CHANNEL_READINESS_STATES.MAPPED_VALID) {
      blockers.push("CHANNEL_PARENT_NOT_OPERATIONALLY_MAPPED");
    }
  } else {
    const ownership = await loadDistributorOwnership({
      distributorAccountId: validation.parent._id,
      companyId,
      session,
      dependencies: deps,
    });
    proposedHierarchy = {
      account: accountSummary(child, childType),
      accountType: childType,
      state: ownership.eligible ? CHANNEL_READINESS_STATES.MAPPED_VALID : CHANNEL_READINESS_STATES.PARENT_DISTRIBUTOR_UNMAPPED,
      channelParent: accountSummary(validation.parent, validation.parentType),
      distributor: distributorAccountSummary(ownership.distributor),
      distributorMapping: mappingSummary(ownership.mapping),
      distributorHealth: ownership.health,
      geography: ownership.health.geography || null,
      primaryFsd: ownership.health.primaryFsd || null,
      supervisoryOwnership: ownership.health.supervisoryOwnership || null,
    };
    if (!ownership.eligible) blockers.push("DISTRIBUTOR_NOT_ELIGIBLE_FOR_NEW_CHANNEL_MAPPING");
    warnings.push(...(ownership.health.warnings || []));
  }
  if (idempotent) {
    blockers.length = 0;
    warnings.push(...(current.warnings || []));
  }
  return {
    canApply: blockers.length === 0,
    idempotent,
    operationType: isCustomerMapping ? "CUSTOMER_CHANNEL_PARENT_MAPPING" : `${childType}_DISTRIBUTOR_MAPPING`,
    child: accountSummary(child, childType),
    current,
    proposed: proposedHierarchy,
    proposedParent: accountSummary(validation.parent, validation.parentType),
    reason,
    warnings: [...new Set(warnings)],
    blockers: [...new Set(blockers)],
  };
};

const applyChannelMapping = async ({ payload, user, req = null, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertCanManageChannelMappings(user);
  const session = await deps.startSession();
  session.startTransaction();
  try {
    const preview = await buildChannelMappingPreview({ payload, user, session, dependencies: deps });
    if (preview.blockers.length) throw new ApiError(409, "Channel mapping contains blocking conflicts", preview.blockers);
    if (preview.idempotent) {
      await session.abortTransaction().catch(() => {});
      return { applied: true, idempotent: true, hierarchy: preview.current };
    }
    const child = await loadAccount({ accountId: preview.child.id, companyId, session, dependencies: deps });
    if (child.parentAccountId && !sameId(child.parentAccountId, preview.proposedParent.id)) {
      throw new ApiError(409, "Existing channel parent replacement is deferred from Phase 6A");
    }
    const operationId = deps.newOperationId();
    const oldRelationship = {
      parentAccountId: child.parentAccountId?._id || child.parentAccountId || null,
      parentRelationshipType: child.parentRelationshipType || null,
    };
    child.parentAccountId = preview.proposedParent.id;
    child.parentRelationshipType = String(preview.proposedParent.accountType || "").toLowerCase();
    child.updatedBy = user._id;
    await child.save({ session, validateModifiedOnly: true });
    const action = preview.child.accountType === CHANNEL_ACCOUNT_TYPES.DEALER
      ? "DEALER_DISTRIBUTOR_MAPPED"
      : preview.child.accountType === CHANNEL_ACCOUNT_TYPES.RETAILER
        ? "RETAILER_DISTRIBUTOR_MAPPED"
        : "CUSTOMER_CHANNEL_PARENT_MAPPED";
    await deps.writeAuditLog({
      companyId,
      actorId: user._id,
      action,
      entityType: "Account",
      entityId: child._id,
      metadata: {
        operationId,
        childAccountId: child._id,
        childAccountType: preview.child.accountType,
        oldRelationship,
        newRelationship: {
          parentAccountId: preview.proposedParent.id,
          parentRelationshipType: child.parentRelationshipType,
        },
        reason: preview.reason,
      },
      req,
      session,
    });
    await session.commitTransaction();
    const hierarchy = await deriveChannelHierarchy({ account: child, companyId, dependencies: deps });
    return { applied: true, idempotent: false, operationId, account: accountSummary(child, preview.child.accountType), hierarchy };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
};

const listChannelReadiness = async ({ user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId } = assertCanManageChannelMappings(user);
  const masters = await deps.CrmMaster.find({
    companyId,
    module: "account",
    type: "account_type",
    code: { $in: Object.values(CHANNEL_ACCOUNT_TYPES) },
  });
  const masterByCode = new Map((masters || []).map((item) => [typeCode(item), item]));
  const childTypeIds = [CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER, CHANNEL_ACCOUNT_TYPES.CUSTOMER]
    .map((code) => masterByCode.get(code)?._id)
    .filter(Boolean);
  let accountQuery = deps.Account.find({ companyId, accountTypeId: { $in: childTypeIds }, deletedAt: null });
  accountQuery = populate(accountQuery, "accountTypeId", "name code module type isActive");
  accountQuery = populate(accountQuery, "assignedTo", "fullName employeeId status");
  const accounts = await accountQuery;
  const rows = [];
  for (const account of accounts || []) {
    rows.push(await deriveChannelHierarchy({ account, companyId, dependencies: deps }));
  }
  rows.sort((left, right) => String(left.account.name).localeCompare(String(right.account.name)));
  const group = (type) => rows.filter((row) => row.accountType === type);
  const distributors = [];
  const distributorMaster = masterByCode.get(CHANNEL_ACCOUNT_TYPES.DISTRIBUTOR);
  if (distributorMaster) {
    let distributorQuery = deps.Account.find({ companyId, accountTypeId: distributorMaster._id, deletedAt: null });
    distributorQuery = populate(distributorQuery, "accountTypeId", "name code module type isActive");
    distributorQuery = populate(distributorQuery, "assignedTo", "fullName employeeId status");
    for (const distributor of await distributorQuery) {
      const ownership = await loadDistributorOwnership({ distributorAccountId: distributor._id, companyId, dependencies: deps });
      distributors.push({
        ...distributorAccountSummary(ownership.distributor),
        mapping: mappingSummary(ownership.mapping),
        mappingHealth: ownership.health,
        eligibleForNewMapping: ownership.eligible,
      });
    }
  }
  const issueStates = new Set(Object.values(CHANNEL_READINESS_STATES).filter((state) => state !== CHANNEL_READINESS_STATES.MAPPED_VALID));
  return {
    summary: {
      total: rows.length,
      dealers: group(CHANNEL_ACCOUNT_TYPES.DEALER).length,
      retailers: group(CHANNEL_ACCOUNT_TYPES.RETAILER).length,
      customers: group(CHANNEL_ACCOUNT_TYPES.CUSTOMER).length,
      mappedValid: rows.filter((row) => row.state === CHANNEL_READINESS_STATES.MAPPED_VALID).length,
      issues: rows.filter((row) => issueStates.has(row.state)).length,
    },
    dealers: group(CHANNEL_ACCOUNT_TYPES.DEALER),
    retailers: group(CHANNEL_ACCOUNT_TYPES.RETAILER),
    customers: group(CHANNEL_ACCOUNT_TYPES.CUSTOMER),
    issues: rows.filter((row) => issueStates.has(row.state)),
    distributors,
  };
};

const getChannelHierarchy = async ({ accountId, expectedType = null, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId, role } = assertCanReadChannelHierarchy(user);
  if (["sales_manager", "sales_executive", "sales"].includes(role)) {
    const visibility = await resolveSalesVisibilityContext({ user, companyId, dependencies: {
      Account: deps.Account,
      CrmMaster: deps.CrmMaster,
      DistributorAssignment: deps.DistributorMapping,
    } });
    await assertAccountWithinVisibility({
      context: visibility,
      accountId,
      companyId,
      dependencies: {
        Account: deps.Account,
        CrmMaster: deps.CrmMaster,
        DistributorAssignment: deps.DistributorMapping,
      },
    });
  }
  const account = await loadAccount({ accountId, companyId, dependencies: deps });
  if (!account) throw new ApiError(404, "Channel Account not found");
  const hierarchy = await deriveChannelHierarchy({ account, companyId, dependencies: deps });
  if (expectedType && hierarchy.accountType !== expectedType) throw new ApiError(400, `Account must be ${expectedType}`);
  const audits = await deps.AuditLog.find({
    companyId,
    entityType: "Account",
    entityId: account._id,
    action: { $in: ["DEALER_DISTRIBUTOR_MAPPED", "RETAILER_DISTRIBUTOR_MAPPED", "CUSTOMER_CHANNEL_PARENT_MAPPED"] },
  }).sort({ createdAt: -1 });
  return { ...hierarchy, history: audits || [] };
};

const getDistributorChannelAccounts = async ({ distributorAccountId, user, dependencies = {} }) => {
  const deps = depsFor(dependencies);
  const { companyId, role } = assertCanReadChannelHierarchy(user);
  if (["sales_manager", "sales_executive", "sales"].includes(role)) {
    const visibility = await resolveSalesVisibilityContext({ user, companyId, dependencies: {
      Account: deps.Account,
      CrmMaster: deps.CrmMaster,
      DistributorAssignment: deps.DistributorMapping,
    } });
    await assertAccountWithinVisibility({
      context: visibility,
      accountId: distributorAccountId,
      companyId,
      dependencies: {
        Account: deps.Account,
        CrmMaster: deps.CrmMaster,
        DistributorAssignment: deps.DistributorMapping,
      },
    });
  }
  const ownership = await loadDistributorOwnership({ distributorAccountId, companyId, dependencies: deps });
  let childrenQuery = deps.Account.find({ companyId, parentAccountId: ownership.distributor._id, deletedAt: null });
  childrenQuery = populate(childrenQuery, "accountTypeId", "name code module type isActive");
  const children = await childrenQuery;
  const channelAccounts = [];
  for (const child of children || []) {
    const code = (await resolveCanonicalType({ account: child, companyId, dependencies: deps })).code;
    if ([CHANNEL_ACCOUNT_TYPES.DEALER, CHANNEL_ACCOUNT_TYPES.RETAILER].includes(code)) {
      channelAccounts.push(accountSummary(child, code));
    }
  }
  return { distributor: distributorAccountSummary(ownership.distributor), mappingHealth: ownership.health, channelAccounts };
};

module.exports = {
  assertCanManageChannelMappings,
  assertCanReadChannelHierarchy,
  resolveCanonicalType,
  validateInitialParent,
  assertNoParentCycle,
  assertChannelParentMutationAllowed,
  loadDistributorOwnership,
  deriveChannelHierarchy,
  buildChannelMappingPreview,
  applyChannelMapping,
  listChannelReadiness,
  getChannelHierarchy,
  getDistributorChannelAccounts,
};
