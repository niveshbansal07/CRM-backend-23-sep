const mongoose = require("mongoose");
const Account = require("../models/Account");
const Lead = require("../models/Lead");
const Visit = require("../models/Visit");
const Order = require("../models/Order");
const CrmMaster = require("../models/CrmMaster");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const {
    getAccountTypeMaster,
    isCanonicalDistributorType,
    allocateDistributorBusinessId,
} = require("./distributorAccount.service");
const { assertDistributorAccountMutationAllowed } = require("./distributorSalesMapping.service");
const {
    validateInitialParent,
    assertChannelParentMutationAllowed,
} = require("./channelMapping.service");
const {
    andFilters,
    resolveSalesVisibilityContext,
    resolveAccessibleAccountScope,
    buildLeadVisibilityFilter,
    buildVisitVisibilityFilter,
    buildOrderVisibilityFilter,
    assertEmployeeWithinVisibility,
    assertAccountWithinVisibility,
} = require("./salesVisibility.service");

const ADMIN_ROLES = ["company_admin", "sub_admin"];
const SALES_ROLES = ["sales_head", "sales_manager", "sales_executive", "sales"];

const assertCompanyId = (companyId) => {
    if (!companyId) {
        throw new ApiError(400, "Company context is required");
    }
};

const cleanPayload = (payload = {}) => {
    const blockedFields = [
        "companyId",
        "createdBy",
        "createdAt",
        "distributorBusinessId",
        "geographyId",
        "primaryFsdId",
        "effectiveFrom",
        "effectiveTo",
    ];
    const data = { ...payload };
    blockedFields.forEach((field) => delete data[field]);
    return data;
};

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const accountPopulate = [
    { path: "accountTypeId", select: "name code module type color" },
    { path: "parentAccountId", select: "name accountTypeId status" },
    { path: "assignedTo", select: "fullName email role" },
    { path: "reportingManagerId", select: "fullName email role" },
];

const isAccountType = (account, expected) => {
    const master = account?.accountTypeId;
    const haystack = `${master?.code || ""} ${master?.name || ""}`.toLowerCase();
    return haystack.includes(expected);
};

const resolveTypeIds = async (companyId, type) => {
    if (!type) return null;
    if (isObjectId(type)) return [type];

    const normalized = String(type).trim().toLowerCase();
    const masters = await CrmMaster.find({
        companyId,
        module: "account",
        type: "account_type",
        $or: [
            { code: normalized.toUpperCase() },
            { normalizedName: normalized.replace(/_/g, " ") },
        ],
    })
        .select("_id")
        .lean();

    return masters.map((master) => master._id);
};

const buildListFilter = async (companyId, filters = {}) => {
    assertCompanyId(companyId);

    const query = { companyId, deletedAt: null };
  if (filters.status) query.status = filters.status;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo === "me" ? filters.currentUserId : filters.assignedTo;
  if (filters.accountTypeId) query.accountTypeId = filters.accountTypeId;
  if (filters.parentAccountId) query.parentAccountId = filters.parentAccountId;

  if (filters.type || filters.accountType) {
    const typeIds = await resolveTypeIds(companyId, filters.type || filters.accountType);
    query.accountTypeId = { $in: typeIds };
  }

  if (filters.search) {
    const search = String(filters.search).trim();
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { city: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  return query;
};

const listAccounts = async (companyId, filters = {}, user = null) => {
    const baseQuery = await buildListFilter(companyId, filters);
    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    const accountScope = visibility ? await resolveAccessibleAccountScope(visibility) : { filter: {} };
    const query = andFilters(baseQuery, accountScope.filter);
    return Account.find(query).populate(accountPopulate).sort({ createdAt: -1 }).lean();
};

const getAccountById = async (id, companyId, user = null) => {
    assertCompanyId(companyId);
    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    const accountScope = visibility ? await resolveAccessibleAccountScope(visibility) : { filter: {} };
    const account = await Account.findOne(andFilters(
        { _id: id, companyId, deletedAt: null },
        accountScope.filter
    )).populate(accountPopulate).lean();
    if (!account) {
        throw new ApiError(404, "Account not found");
    }
    return account;
};

const isTeamMember = async (managerId, userId, companyId) => {
    if (!userId) return false;
    if (String(managerId) === String(userId)) return true;

    const user = await User.findOne({
        _id: userId,
        companyId,
        reportingManagerId: managerId,
        deletedAt: null,
    })
        .select("_id")
        .lean();

    return Boolean(user);
};

const canModifyAccount = async (account, user, companyId) => {
    const role = user.accessRole || getAccessRole(user);
    if (ADMIN_ROLES.includes(role) || role === "sales_head") return true;

    if (role === "sales_manager") {
        return isTeamMember(user._id, account.assignedTo, companyId);
    }

    if (role === "sales_executive" || role === "sales") {
        return (
            String(account.assignedTo || "") === String(user._id) ||
            String(account.createdBy || "") === String(user._id)
        );
    }

    return false;
};

const getAssigneeForAccountAssignment = async (companyId, assigneeId, user = {}) => {
    if (!assigneeId) throw new ApiError(400, "assignedTo is required");
    const role = user.accessRole || getAccessRole(user);
    if (![...ADMIN_ROLES, "sales_head", "sales_manager"].includes(role)) {
        throw new ApiError(403, "Only sales managers, sales heads, and admins can assign customers");
    }

    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    return assertEmployeeWithinVisibility({ context: visibility, employeeId: assigneeId, companyId });
};

const prepareCreatePayload = async (companyId, payload, user) => {
    const role = user.accessRole || getAccessRole(user);
    const data = cleanPayload(payload);

    if (role === "sales_executive" || role === "sales") {
        data.assignedTo = user._id;
        data.reportingManagerId = user.reportingManagerId || user.managerId || null;
    }

    if (role === "sales_manager") {
        data.assignedTo = data.assignedTo || user._id;
        if (String(data.assignedTo) !== String(user._id)) {
            const visibility = await resolveSalesVisibilityContext({ user, companyId });
            await assertEmployeeWithinVisibility({
                context: visibility,
                employeeId: data.assignedTo,
                companyId,
            });
        }
        data.reportingManagerId = user._id;
    }

    return data;
};

const createAccount = async (companyId, payload, user) => {
    assertCompanyId(companyId);
    const data = await prepareCreatePayload(companyId, payload, user);
    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    if (data.assignedTo && String(data.assignedTo) !== String(user?._id)) {
        await assertEmployeeWithinVisibility({ context: visibility, employeeId: data.assignedTo, companyId });
    }
    if (data.parentAccountId) {
        await assertAccountWithinVisibility({ context: visibility, accountId: data.parentAccountId, companyId });
    }
    const type = await getAccountTypeMaster({ companyId, accountTypeId: data.accountTypeId });
    if (isCanonicalDistributorType(type)) {
        if (data.status === "active") {
            throw new ApiError(409, "Distributor must be mapped to an Area and Primary FSD before activation");
        }
        data.distributorBusinessId = await allocateDistributorBusinessId({ companyId });
    }
    const parentValidation = await validateInitialParent({
        companyId,
        accountTypeId: type || data.accountTypeId,
        parentAccountId: data.parentAccountId,
        parentRelationshipType: data.parentRelationshipType,
        allowLegacyDirectDistributorCustomer: true,
    });
    if (parentValidation.governed) {
        data.parentAccountId = parentValidation.parentAccountId;
        data.parentRelationshipType = parentValidation.parentRelationshipType;
    }

    return Account.create({
        ...data,
        companyId,
        createdBy: user?._id || null,
        updatedBy: user?._id || null,
    });
};

const updateAccount = async (id, companyId, payload, user) => {
    assertCompanyId(companyId);
    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    const accountScope = await resolveAccessibleAccountScope(visibility);
    const account = await Account.findOne(andFilters(
        { _id: id, companyId, deletedAt: null },
        accountScope.filter
    ));
    if (!account) {
        throw new ApiError(404, "Account not found");
    }

    const allowed = await canModifyAccount(account, user, companyId);
    if (!allowed) {
        throw new ApiError(403, "You do not have permission to update this account");
    }

    const data = cleanPayload(payload);
    const role = user.accessRole || getAccessRole(user);
    if (data.assignedTo && String(data.assignedTo) !== String(account.assignedTo || "")) {
        if (["sales_executive", "sales"].includes(role) && String(data.assignedTo) !== String(user._id)) {
            throw new ApiError(403, "Field Sales employees cannot assign Accounts to another employee");
        }
        if (!["sales_executive", "sales"].includes(role) && String(data.assignedTo) !== String(user._id)) {
            await assertEmployeeWithinVisibility({
                context: visibility,
                employeeId: data.assignedTo,
                companyId,
            });
        }
    }
    if (data.parentAccountId && String(data.parentAccountId) !== String(account.parentAccountId || "")) {
        await assertAccountWithinVisibility({
            context: visibility,
            accountId: data.parentAccountId,
            companyId,
        });
    }
    await assertChannelParentMutationAllowed({ account, proposedData: data, companyId });
    const mutation = await assertDistributorAccountMutationAllowed({
        account,
        proposedData: data,
        companyId,
    });
    if (mutation.willBeDistributor && !account.distributorBusinessId) {
        account.$locals.allowDistributorBusinessIdInitialization = true;
        account.distributorBusinessId = await allocateDistributorBusinessId({ companyId });
    }
    Object.keys(data).forEach((field) => {
        account[field] = data[field];
    });
    account.updatedBy = user?._id || null;

    await account.save();
    return Account.findById(account._id).populate(accountPopulate);
};

const assignAccount = async (id, companyId, assigneeId, user) => {
    assertCompanyId(companyId);
    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    const accountScope = await resolveAccessibleAccountScope(visibility);
    const assignee = await getAssigneeForAccountAssignment(companyId, assigneeId, user);
    const account = await Account.findOne(andFilters(
        { _id: id, companyId, deletedAt: null },
        accountScope.filter
    ));
    if (!account) throw new ApiError(404, "Account not found");
    await assertDistributorAccountMutationAllowed({
        account,
        proposedData: { assignedTo: assignee._id },
        companyId,
    });

    const role = user.accessRole || getAccessRole(user);
    if (role === "sales_manager" && account.assignedTo && !(await isTeamMember(user._id, account.assignedTo, companyId))) {
        throw new ApiError(403, "Sales managers can reassign only customers in their team");
    }

    account.assignedTo = assignee._id;
    account.reportingManagerId = assignee.reportingManagerId || null;
    account.updatedBy = user?._id || null;
    await account.save();
    return Account.findById(account._id).populate(accountPopulate).lean();
};

const getDistributorWithDealers = async (distributorId, companyId, user = null) => {
    assertCompanyId(companyId);

    const distributor = await getAccountById(distributorId, companyId, user);
    if (!distributor) {
        throw new ApiError(404, "Distributor account not found");
    }

    if (!isAccountType(distributor, "distributor")) {
        throw new ApiError(400, "Account is not a distributor");
    }

    const dealers = await Account.find({ companyId, parentAccountId: distributorId, deletedAt: null })
        .populate(accountPopulate)
        .sort({ name: 1 })
        .lean();

    return { distributor, dealers };
};

const getDealerWithLeadsAndCustomers = async (dealerId, companyId, user = null) => {
    assertCompanyId(companyId);

    const dealer = await getAccountById(dealerId, companyId, user);
    if (!dealer) {
        throw new ApiError(404, "Dealer account not found");
    }

    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    const [leads, customers] = await Promise.all([
        Lead.find(andFilters(
            { companyId, linkedDealerId: dealerId, deletedAt: null },
            visibility ? buildLeadVisibilityFilter(visibility) : {}
        )).sort({ createdAt: -1 }).lean(),
        Account.find({ companyId, parentAccountId: dealerId, deletedAt: null }).populate(accountPopulate).sort({ name: 1 }).lean(),
    ]);

    return { dealer, leads, customers };
};

const getAccountLeads = async (accountId, companyId, user = null) => {
    assertCompanyId(companyId);

    await getAccountById(accountId, companyId, user);
    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    return Lead.find(andFilters({
        companyId,
        deletedAt: null,
        $or: [
            { linkedAccountId: accountId },
            { linkedDealerId: accountId },
            { linkedDistributorId: accountId },
        ],
    }, visibility ? buildLeadVisibilityFilter(visibility) : {}))
        .sort({ createdAt: -1 })
        .lean();
};

const getAccountVisits = async (accountId, companyId, filters = {}, user = null) => {
    assertCompanyId(companyId);
    await getAccountById(accountId, companyId, user);
    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;

    const query = {
        companyId,
        entityId: accountId,
        entityType: { $in: ["Account", "Dealer", "Distributor", "Customer"] },
    };
    if (filters.status) query.status = filters.status;
    if (filters.dateFrom || filters.dateTo) {
        query.startedAt = {};
        if (filters.dateFrom) query.startedAt.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) {
            const to = new Date(filters.dateTo);
            to.setDate(to.getDate() + 1);
            query.startedAt.$lt = to;
        }
    }

    return Visit.find(andFilters(query, visibility ? buildVisitVisibilityFilter(visibility, filters.executiveId) : {}))
        .populate("visitTypeId", "name code expectedDurationMinutes")
        .populate("executiveId", "fullName email role")
        .populate("visitOutcomeId", "name code")
        .sort({ startedAt: -1 })
        .lean();
};

const getAccountOrders = async (accountId, companyId, filters = {}, user = null) => {
    assertCompanyId(companyId);
    await getAccountById(accountId, companyId, user);
    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;

    const query = { companyId, accountId, deletedAt: null };
    if (filters.orderStatus) query.orderStatus = filters.orderStatus;
    if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
    if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};
        if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) {
            const to = new Date(filters.dateTo);
            to.setDate(to.getDate() + 1);
            query.createdAt.$lt = to;
        }
    }

    return Order.find(andFilters(
        query,
        visibility ? buildOrderVisibilityFilter(visibility, { accountIds: [accountId], assignedTo: filters.assignedTo }) : {}
    ))
        .populate("assignedTo", "fullName email role")
        .populate("orderStatus", "name code")
        .populate("paymentStatus", "name code")
        .sort({ createdAt: -1 })
        .lean();
};

const attachChildren = (node, childrenByParent, depth = 1) => {
    if (depth >= 3) return { ...node, children: [] };

    const children = childrenByParent.get(String(node._id)) || [];
    return {
        ...node,
        children: children.map((child) => attachChildren(child, childrenByParent, depth + 1)),
    };
};

const getAccountHierarchyTree = async (companyId, user = null) => {
    assertCompanyId(companyId);

    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    const accountScope = visibility ? await resolveAccessibleAccountScope(visibility) : { filter: {} };
    const accounts = await Account.find(andFilters(
        { companyId, deletedAt: null },
        accountScope.filter
    ))
        .populate(accountPopulate)
        .sort({ name: 1 })
        .lean();

    const childrenByParent = new Map();
    const visibleIds = new Set(accounts.map((account) => String(account._id)));
    accounts.forEach((account) => {
        if (!account.parentAccountId) return;
        const parentId = String(account.parentAccountId._id || account.parentAccountId);
        const existing = childrenByParent.get(parentId) || [];
        existing.push(account);
        childrenByParent.set(parentId, existing);
    });

    const roots = accounts.filter((account) => {
        const parentId = String(account.parentAccountId?._id || account.parentAccountId || "");
        return !parentId || !visibleIds.has(parentId) || isAccountType(account, "distributor");
    });
    return roots.map((root) => attachChildren(root, childrenByParent, 1));
};

const getDistributorAccounts = async (companyId, filters = {}, user = null) => {
    assertCompanyId(companyId);

    const distributorTypeIds = await resolveTypeIds(companyId, "distributor");
    const query = {
        companyId,
        accountTypeId: { $in: distributorTypeIds },
        deletedAt: null,
        status: { $ne: "inactive" },
    };
    const search = String(filters.search || filters.q || "").trim();
    if (search) {
        const pattern = new RegExp(escapeRegex(search), "i");
        query.$or = [{ name: pattern }, { city: pattern }, { phone: pattern }];
    }

    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    const accountScope = visibility ? await resolveAccessibleAccountScope(visibility) : { filter: {} };
    return Account.find(andFilters(query, accountScope.filter))
        .populate(accountPopulate)
        .sort({ name: 1 })
        .lean();
};

module.exports = {
    Account,
    Lead,
    VIEW_ROLES: [...ADMIN_ROLES, ...SALES_ROLES],
    MUTATE_ROLES: [...ADMIN_ROLES, ...SALES_ROLES],
    listAccounts,
    getAccountById,
    createAccount,
    updateAccount,
    assignAccount,
    getDistributorWithDealers,
    getDealerWithLeadsAndCustomers,
    getAccountLeads,
    getAccountVisits,
    getAccountOrders,
    getAccountHierarchyTree,
    getDistributorAccounts,
};
