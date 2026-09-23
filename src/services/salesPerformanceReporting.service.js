const mongoose = require("mongoose");
const SalesTargetPlan = require("../models/SalesTargetPlan");
const SalesTargetAllocation = require("../models/SalesTargetAllocation");
const SalesAchievementEvent = require("../models/SalesAchievementEvent");
const SalesAchievementCaptureFailure = require("../models/SalesAchievementCaptureFailure");
const CompanySalesPerformancePolicy = require("../models/CompanySalesPerformancePolicy");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Visit = require("../models/Visit");
const Lead = require("../models/Lead");
const FollowUp = require("../models/FollowUp");
const Account = require("../models/Account");
const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const { SALES_PERFORMANCE } = require("../constants/salesPerformance");
const { moneyDecimal, moneyNumber, roundMoney } = require("../utils/salesPerformance");
const { getAccessRole } = require("../utils/roleAccess");
const {
  TARGET_READ_ROLES,
  HEAD_WRITE_ROLES,
  assertRole,
  getPlan,
  buildAllocationScope,
  serializeAllocation,
} = require("./salesTarget.service");
const {
  andFilters,
  resolveSalesVisibilityContext,
  resolveAccessibleAccountScope,
  buildOrderVisibilityFilter,
  buildLeadVisibilityFilter,
  buildVisitVisibilityFilter,
  buildFollowUpVisibilityFilter,
} = require("./salesVisibility.service");
const { calculateOrderBookingAmount, resolveOrderAttribution, recordOrderCreatedAchievement } = require("./salesAchievement.service");
const { writeAuditLog } = require("./auditLog.service");

const MANAGEMENT_ROLES = ["super_admin", "company_admin", "sales_head"];
const RETRY_ROLES = ["super_admin", "company_admin", "sales_head"];
const EMPTY_ID = "000000000000000000000000";
const toId = (value) => String(value?._id || value?.id || value || "");
const isManagement = (user) => MANAGEMENT_ROLES.includes(getAccessRole(user));
const objectId = (value) => new mongoose.Types.ObjectId(String(value));
const inSession = (query, session) => session && query?.session ? query.session(session) : query;

const findDashboardPlan = async ({ companyId, user, planId = null, periodKey = null }) => {
  assertRole(user, TARGET_READ_ROLES);
  const management = isManagement(user);
  let plan;
  if (planId) plan = await getPlan(companyId, planId);
  else {
    const query = { companyId, metricCode: SALES_PERFORMANCE.METRIC_CODE, status: "ACTIVE" };
    if (periodKey) query.periodKey = String(periodKey);
    else {
      const now = new Date();
      query.periodStart = { $lte: now };
      query.periodEndExclusive = { $gt: now };
    }
    plan = await SalesTargetPlan.findOne(query).sort({ version: -1 }).lean();
  }
  if (!plan) return null;
  if (!management && plan.status !== "ACTIVE") throw new ApiError(404, "Active target plan not found");
  return plan.toObject ? plan.toObject() : plan;
};

const eventVisibilityFilter = async ({ companyId, user, context = null }) => {
  if (isManagement(user)) return {};
  const resolved = context || await resolveSalesVisibilityContext({ user, companyId });
  if (resolved.hierarchyLevel === 1) return { "snapshot.primaryFsdId": user._id };
  const field = { 2: "areaId", 3: "branchId", 4: "regionId", 5: "zoneId" }[resolved.hierarchyLevel];
  if (!field || !resolved.geographyId) return { _id: objectId(EMPTY_ID) };
  return { [`snapshot.${field}`]: objectId(resolved.geographyId) };
};

const aggregateAchievementByOwner = async ({ companyId, plan }) => {
  const [result = { eligible: [], quality: [] }] = await SalesAchievementEvent.aggregate([
    { $match: {
      companyId: objectId(companyId),
      metricCode: plan.metricCode,
      occurredAt: { $gte: new Date(plan.periodStart), $lt: new Date(plan.periodEndExclusive) },
    } },
    { $facet: {
      eligible: [
        { $match: { rollupEligible: true, confidence: { $in: ["EXACT", "INFERRED"] } } },
        { $project: {
          amount: 1,
          owners: [
            { ownerType: "COMPANY", ownerId: objectId(companyId) },
            { ownerType: "ZONE", ownerId: "$snapshot.zoneId" },
            { ownerType: "REGION", ownerId: "$snapshot.regionId" },
            { ownerType: "BRANCH", ownerId: "$snapshot.branchId" },
            { ownerType: "AREA", ownerId: "$snapshot.areaId" },
            { ownerType: "EMPLOYEE_FSD", ownerId: "$snapshot.primaryFsdId" },
            { ownerType: "DISTRIBUTOR", ownerId: "$snapshot.rootDistributorId" },
          ],
        } },
        { $unwind: "$owners" },
        { $match: { "owners.ownerId": { $ne: null } } },
        { $group: { _id: { ownerType: "$owners.ownerType", ownerId: "$owners.ownerId" }, amount: { $sum: "$amount" }, eventCount: { $sum: 1 } } },
      ],
      quality: [
        { $group: {
          _id: null,
          unattributableAmount: { $sum: { $cond: [{ $eq: ["$rollupEligible", false] }, "$amount", { $toDecimal: "0" }] } },
          unattributableCount: { $sum: { $cond: [{ $eq: ["$rollupEligible", false] }, 1, 0] } },
          warningCount: { $sum: { $cond: [{ $eq: ["$dataQuality", "WARNING"] }, 1, 0] } },
          totalEventCount: { $sum: 1 },
        } },
      ],
    } },
  ]);
  const byOwner = new Map((result.eligible || []).map((row) => [`${row._id.ownerType}:${toId(row._id.ownerId)}`, { amount: moneyNumber(row.amount), eventCount: row.eventCount }]));
  const quality = result.quality?.[0] || {};
  return {
    byOwner,
    quality: {
      unattributableAmount: moneyNumber(quality.unattributableAmount),
      unattributableCount: Number(quality.unattributableCount || 0),
      warningCount: Number(quality.warningCount || 0),
      totalEventCount: Number(quality.totalEventCount || 0),
    },
  };
};

const visibleAllocations = async ({ companyId, planId, user }) => {
  const scope = await buildAllocationScope(companyId, user);
  return SalesTargetAllocation.find({ companyId, planId, ...(scope || {}) }).sort({ createdAt: 1 }).lean();
};

const buildPerformanceTree = ({ allocations, rollup, companyWide }) => {
  const visibleIds = new Set(allocations.map((row) => toId(row._id)));
  const nodes = allocations.map((row) => {
    const target = moneyNumber(row.targetValue);
    const achievement = rollup.byOwner.get(`${row.ownerType}:${toId(row.ownerId)}`) || { amount: 0, eventCount: 0 };
    const allocated = moneyNumber(row.allocatedValue);
    const unallocated = moneyNumber(row.unallocatedValue);
    return {
      allocationId: row._id,
      parentAllocationId: row.parentAllocationId,
      owner: { id: row.ownerId, type: row.ownerType, name: row.ownerNameSnapshot, code: row.ownerCodeSnapshot || "" },
      target,
      achievement: achievement.amount,
      remaining: roundMoney(target - achievement.amount),
      achievementPercentage: target > 0 ? roundMoney((achievement.amount / target) * 100) : null,
      allocated,
      unallocated,
      eventCount: achievement.eventCount,
      childCount: 0,
      warnings: [
        ...(unallocated > 0 ? [{ code: "TARGET_UNDER_ALLOCATED", amount: unallocated }] : []),
        ...(achievement.amount === 0 ? [{ code: "NO_ACHIEVEMENT_YET" }] : []),
      ],
      children: [],
    };
  });
  const byId = new Map(nodes.map((node) => [toId(node.allocationId), node]));
  const roots = [];
  for (const node of nodes) {
    const parentId = toId(node.parentAllocationId);
    if (parentId && visibleIds.has(parentId)) byId.get(parentId).children.push(node);
    else roots.push(node);
  }
  nodes.forEach((node) => { node.childCount = node.children.length; });
  if (companyWide) {
    const company = roots.find((node) => node.owner.type === "COMPANY");
    if (company && rollup.quality.unattributableAmount > 0) company.warnings.push({ code: "UNATTRIBUTABLE_ORDER_BOOKING_EXISTS", amount: rollup.quality.unattributableAmount });
  }
  return { roots, flat: nodes };
};

const loadOperationalKpis = async ({ companyId, user, plan }) => {
  const context = await resolveSalesVisibilityContext({ user, companyId });
  const accountScope = await resolveAccessibleAccountScope(context);
  const period = { $gte: new Date(plan.periodStart), $lt: new Date(plan.periodEndExclusive) };
  const employeeIds = context.hierarchyLevel === 1 ? [context.employeeId] : context.accessibleEmployeeIds;
  const [ordersCount, visitsCount, completedVisits, leadsCreated, leadsConverted, followUps, completedFollowUps] = await Promise.all([
    Order.countDocuments(andFilters({ companyId, deletedAt: null, createdAt: period }, buildOrderVisibilityFilter(context, { accountIds: accountScope.accountIds }))),
    Visit.countDocuments(andFilters({ companyId, createdAt: period }, buildVisitVisibilityFilter(context))),
    Visit.countDocuments(andFilters({ companyId, createdAt: period, status: "completed" }, buildVisitVisibilityFilter(context))),
    Lead.countDocuments(andFilters({ companyId, deletedAt: null, createdAt: period }, buildLeadVisibilityFilter(context))),
    Lead.countDocuments(andFilters({ companyId, deletedAt: null, convertedAt: period }, buildLeadVisibilityFilter(context))),
    FollowUp.countDocuments(andFilters({ companyId, deletedAt: null, scheduledAt: period }, buildFollowUpVisibilityFilter(context))),
    FollowUp.countDocuments(andFilters({ companyId, deletedAt: null, completedAt: period, status: "completed" }, buildFollowUpVisibilityFilter(context))),
  ]);
  return {
    classification: "OPERATIONAL_KPI",
    ordersCount,
    visitsCount,
    completedVisits,
    leadsCreated,
    leadsConverted,
    leadConversionRate: leadsCreated > 0 ? roundMoney((leadsConverted / leadsCreated) * 100) : null,
    followUps,
    completedFollowUps,
    followUpCompletionRate: followUps > 0 ? roundMoney((completedFollowUps / followUps) * 100) : null,
    accessibleEmployeeCount: employeeIds?.length || 0,
    accessibleDistributorCount: accountScope.distributorIds?.length || 0,
  };
};

const getPerformanceDashboard = async ({ companyId, user, filters = {} }) => {
  const plan = await findDashboardPlan({ companyId, user, planId: filters.planId, periodKey: filters.periodKey });
  if (!plan) return { status: "NO_ACTIVE_TARGET_PLAN", message: "No active Target plan for the selected period", plan: null, scorecard: null, tree: [], operationalKpis: null };
  const [allocations, rollup, operationalKpis, context] = await Promise.all([
    visibleAllocations({ companyId, planId: plan._id, user }),
    aggregateAchievementByOwner({ companyId, plan }),
    loadOperationalKpis({ companyId, user, plan }),
    resolveSalesVisibilityContext({ user, companyId }),
  ]);
  const companyWide = isManagement(user);
  const tree = buildPerformanceTree({ allocations, rollup, companyWide });
  const scorecard = tree.roots[0] || null;
  let status = "READY";
  let message = "Target performance is available";
  if (!scorecard) { status = "NO_TARGET_ASSIGNED"; message = "No Target is assigned within the current Sales scope"; }
  else if (scorecard.achievement === 0) { status = "NO_ACHIEVEMENT_YET"; message = "Target exists, but no Order Booking achievement has been recorded yet"; }
  else if (scorecard.unallocated > 0) { status = "TARGET_UNDER_ALLOCATED"; message = "The active Target is partially unallocated"; }
  return {
    status, message,
    classification: "TARGET_KPI",
    metric: { code: plan.metricCode, label: plan.metricLabel, trigger: SALES_PERFORMANCE.TRIGGER, valueBasis: SALES_PERFORMANCE.VALUE_BASIS },
    plan: { _id: plan._id, periodKey: plan.periodKey, periodStart: plan.periodStart, periodEndExclusive: plan.periodEndExclusive, status: plan.status, version: plan.version, currency: plan.currency, timezone: plan.timezone, policyVersion: plan.policyVersion },
    visibility: { scopeType: context.scopeType, hierarchyLevel: context.hierarchyLevel, geographyId: context.geographyId, geographyName: context.geographyName },
    scorecard,
    tree: tree.roots,
    flat: tree.flat,
    dataQuality: companyWide ? rollup.quality : {},
    operationalKpis,
  };
};

const createPlanRevision = async ({ companyId, planId, user, reason, req = null }) => {
  assertRole(user, HEAD_WRITE_ROLES, "Only Sales Head can create a Target revision");
  const revisionReason = String(reason || "").trim();
  if (!revisionReason) throw new ApiError(400, "Revision reason is required");
  const session = await mongoose.startSession();
  session.startTransaction();
  let revision;
  try {
    const source = await getPlan(companyId, planId, { session });
    if (source.status !== "ACTIVE") throw new ApiError(409, "Only an ACTIVE Target plan can be revised");
    const periodQuery = { companyId, metricCode: source.metricCode, periodStart: source.periodStart, periodEndExclusive: source.periodEndExclusive };
    const inFlight = await inSession(SalesTargetPlan.exists({ ...periodQuery, status: { $in: ["DRAFT", "SUBMITTED"] } }), session);
    if (inFlight) throw new ApiError(409, "A draft or submitted revision already exists for this period");
    const latest = await inSession(SalesTargetPlan.findOne(periodQuery).sort({ version: -1 }), session).lean();
    [revision] = await SalesTargetPlan.create([{
      companyId, metricCode: source.metricCode, metricLabel: source.metricLabel, periodType: source.periodType,
      periodKey: source.periodKey, periodStart: source.periodStart, periodEndExclusive: source.periodEndExclusive,
      fiscalYearLabel: source.fiscalYearLabel, currency: source.currency, timezone: source.timezone,
      policyVersion: source.policyVersion, version: Number(latest?.version || source.version) + 1,
      revisionOfPlanId: source._id, revisionReason, status: "DRAFT", createdBy: user._id, updatedBy: user._id,
    }], { session });
    const sourceAllocations = await inSession(SalesTargetAllocation.find({ companyId, planId: source._id }).sort({ createdAt: 1 }), session).lean();
    const idMap = new Map();
    let remaining = [...sourceAllocations];
    while (remaining.length) {
      const ready = remaining.filter((row) => !row.parentAllocationId || idMap.has(toId(row.parentAllocationId)));
      if (!ready.length) throw new ApiError(409, "Source allocation tree is structurally invalid");
      for (const row of ready) {
        const [copy] = await SalesTargetAllocation.create([{
          companyId, planId: revision._id, parentAllocationId: row.parentAllocationId ? idMap.get(toId(row.parentAllocationId)) : null,
          ownerType: row.ownerType, ownerId: row.ownerId, ownerNameSnapshot: row.ownerNameSnapshot, ownerCodeSnapshot: row.ownerCodeSnapshot,
          targetValue: row.targetValue, allocatedValue: row.allocatedValue, unallocatedValue: row.unallocatedValue,
          createdBy: user._id, updatedBy: user._id,
        }], { session });
        idMap.set(toId(row._id), copy._id);
      }
      const readyIds = new Set(ready.map((row) => toId(row._id)));
      remaining = remaining.filter((row) => !readyIds.has(toId(row._id)));
    }
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_TARGET_REVISION_CREATED", entityType: "SalesTargetPlan", entityId: revision._id, metadata: { sourcePlanId: source._id, version: revision.version, revisionReason, copiedAllocationCount: sourceAllocations.length }, req, session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000 || error?.errorLabels?.includes("TransientTransactionError")) throw new ApiError(409, "Target revision changed concurrently; refresh and retry");
    throw error;
  } finally { await session.endSession(); }
  return { plan: revision.toObject(), copied: true };
};

const listPlanRevisions = async ({ companyId, planId, user }) => {
  assertRole(user, MANAGEMENT_ROLES, "Target plan history is restricted to Sales Head and Company Admin");
  const plan = await getPlan(companyId, planId);
  return SalesTargetPlan.find({ companyId, metricCode: plan.metricCode, periodStart: plan.periodStart, periodEndExclusive: plan.periodEndExclusive })
    .populate("submittedBy approvedBy rejectedBy createdBy", "fullName email")
    .sort({ version: -1 }).lean();
};

const comparePlans = async ({ companyId, planId, otherPlanId, user }) => {
  assertRole(user, MANAGEMENT_ROLES, "Target comparison is restricted to Sales Head and Company Admin");
  const [oldPlan, newPlan] = await Promise.all([getPlan(companyId, planId), getPlan(companyId, otherPlanId)]);
  if (oldPlan.metricCode !== newPlan.metricCode || +oldPlan.periodStart !== +newPlan.periodStart || +oldPlan.periodEndExclusive !== +newPlan.periodEndExclusive) throw new ApiError(400, "Target plans must share metric and period for comparison");
  const [oldRows, newRows] = await Promise.all([
    SalesTargetAllocation.find({ companyId, planId: oldPlan._id }).lean(),
    SalesTargetAllocation.find({ companyId, planId: newPlan._id }).lean(),
  ]);
  const oldMap = new Map(oldRows.map((row) => [`${row.ownerType}:${toId(row.ownerId)}`, row]));
  const newMap = new Map(newRows.map((row) => [`${row.ownerType}:${toId(row.ownerId)}`, row]));
  const allocationPath = (row, rows) => {
    if (!row) return "";
    const byId = new Map(rows.map((item) => [toId(item._id), item]));
    const names = [];
    const visited = new Set();
    let current = row;
    while (current && !visited.has(toId(current._id))) {
      visited.add(toId(current._id));
      names.unshift(current.ownerNameSnapshot || current.ownerType);
      current = current.parentAllocationId ? byId.get(toId(current.parentAllocationId)) : null;
    }
    return names.join(" → ");
  };
  const keys = [...new Set([...oldMap.keys(), ...newMap.keys()])];
  const rows = keys.map((key) => {
    const oldRow = oldMap.get(key); const newRow = newMap.get(key);
    const oldTarget = moneyNumber(oldRow?.targetValue); const newTarget = moneyNumber(newRow?.targetValue);
    const difference = roundMoney(newTarget - oldTarget);
    const oldPath = allocationPath(oldRow, oldRows); const newPath = allocationPath(newRow, newRows);
    return {
      key,
      owner: { type: newRow?.ownerType || oldRow.ownerType, id: newRow?.ownerId || oldRow.ownerId, name: newRow?.ownerNameSnapshot || oldRow.ownerNameSnapshot, code: newRow?.ownerCodeSnapshot || oldRow.ownerCodeSnapshot || "", path: newPath || oldPath },
      oldPath, newPath,
      oldTarget, newTarget, difference,
      percentageDifference: oldTarget > 0 ? roundMoney((difference / oldTarget) * 100) : null,
      changeType: !oldRow ? "ADDED" : !newRow ? "REMOVED" : difference !== 0 || oldPath !== newPath ? "CHANGED" : "UNCHANGED",
    };
  });
  const totals = rows.filter((row) => row.owner.type === "COMPANY")[0] || { oldTarget: 0, newTarget: 0, difference: 0, percentageDifference: null };
  return {
    oldPlan: { _id: oldPlan._id, version: oldPlan.version, status: oldPlan.status, periodKey: oldPlan.periodKey },
    newPlan: { _id: newPlan._id, version: newPlan.version, status: newPlan.status, periodKey: newPlan.periodKey },
    totals: { oldTarget: totals.oldTarget, newTarget: totals.newTarget, difference: totals.difference, percentageDifference: totals.percentageDifference },
    summary: { added: rows.filter((row) => row.changeType === "ADDED").length, removed: rows.filter((row) => row.changeType === "REMOVED").length, changed: rows.filter((row) => row.changeType === "CHANGED").length, unchanged: rows.filter((row) => row.changeType === "UNCHANGED").length },
    rows,
  };
};

const eventFilterFromQuery = (filters = {}) => {
  const mapping = { zoneId: "zoneId", regionId: "regionId", branchId: "branchId", areaId: "areaId", fsdId: "primaryFsdId", distributorId: "rootDistributorId" };
  const clauses = [];
  for (const [key, snapshotField] of Object.entries(mapping)) {
    if (!filters[key]) continue;
    if (!mongoose.Types.ObjectId.isValid(String(filters[key]))) throw new ApiError(400, `${key} is invalid`);
    clauses.push({ [`snapshot.${snapshotField}`]: objectId(filters[key]) });
  }
  return clauses.length ? { $and: clauses } : {};
};

const serializeEvent = (event, { orders, accounts, users, accessibleOrderIds }) => {
  const order = orders.get(toId(event.sourceId)) || {};
  const sourceAccount = accounts.get(toId(event.snapshot?.sourceAccountId)) || {};
  const distributor = accounts.get(toId(event.snapshot?.rootDistributorId)) || {};
  return {
    id: event._id,
    order: { id: event.sourceId, number: order.orderNumber || "", canOpen: accessibleOrderIds.has(toId(event.sourceId)), link: accessibleOrderIds.has(toId(event.sourceId)) ? `/sales/orders/${toId(event.sourceId)}` : null },
    occurredAt: event.occurredAt,
    amount: moneyNumber(event.amount),
    currency: event.currency,
    account: { id: event.snapshot?.sourceAccountId, name: sourceAccount.name || "", type: event.snapshot?.sourceAccountType || "" },
    distributor: { id: event.snapshot?.rootDistributorId, name: event.snapshot?.rootDistributorName || distributor.name || "", code: event.snapshot?.rootDistributorCode || distributor.distributorBusinessId || "" },
    fsd: { id: event.snapshot?.primaryFsdId, name: event.snapshot?.primaryFsdName || "" },
    geography: {
      area: { id: event.snapshot?.areaId, name: event.snapshot?.areaName || "", code: event.snapshot?.areaCode || "" },
      branch: { id: event.snapshot?.branchId, name: event.snapshot?.branchName || "", code: event.snapshot?.branchCode || "" },
      region: { id: event.snapshot?.regionId, name: event.snapshot?.regionName || "", code: event.snapshot?.regionCode || "" },
      zone: { id: event.snapshot?.zoneId, name: event.snapshot?.zoneName || "", code: event.snapshot?.zoneCode || "" },
    },
    createdEmployee: users.get(toId(order.createdBy)) || null,
    confidence: event.confidence,
    dataQuality: event.dataQuality,
    rollupEligible: event.rollupEligible,
    attributionSource: event.snapshot?.attributionSource || "",
    warnings: event.snapshot?.warnings || [],
  };
};

const listAchievementEvents = async ({ companyId, user, filters = {}, internalLimit = null }) => {
  assertRole(user, TARGET_READ_ROLES);
  const context = await resolveSalesVisibilityContext({ user, companyId });
  const scope = await eventVisibilityFilter({ companyId, user, context });
  const requested = eventFilterFromQuery(filters);
  const query = andFilters({ companyId, metricCode: SALES_PERFORMANCE.METRIC_CODE }, scope, requested);
  if (filters.planId) {
    const plan = await findDashboardPlan({ companyId, user, planId: filters.planId });
    if (!plan) throw new ApiError(404, "Target plan not found");
    query.$and = [...(query.$and || []), { occurredAt: { $gte: plan.periodStart, $lt: plan.periodEndExclusive } }];
  }
  if (filters.quality === "UNATTRIBUTABLE") query.$and = [...(query.$and || []), { rollupEligible: false }];
  if (filters.quality === "WARNING") query.$and = [...(query.$and || []), { dataQuality: "WARNING" }];
  const limit = internalLimit || Math.min(100, Math.max(1, Number(filters.limit || 50)));
  const page = Math.max(1, Number(filters.page || 1));
  const [events, total] = await Promise.all([
    SalesAchievementEvent.find(query).sort({ occurredAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SalesAchievementEvent.countDocuments(query),
  ]);
  const orderIds = events.map((event) => event.sourceId);
  const accountIds = events.flatMap((event) => [event.snapshot?.sourceAccountId, event.snapshot?.rootDistributorId]).filter(Boolean);
  const orders = await Order.find({ _id: { $in: orderIds }, companyId, deletedAt: null }).select("_id orderNumber accountId assignedTo createdBy").lean();
  const accountScope = await resolveAccessibleAccountScope(context);
  const accessibleOrders = await Order.find(andFilters({ _id: { $in: orderIds }, companyId, deletedAt: null }, buildOrderVisibilityFilter(context, { accountIds: accountScope.accountIds }))).select("_id").lean();
  const [accounts, creators] = await Promise.all([
    Account.find({ _id: { $in: accountIds }, companyId }).select("_id name distributorBusinessId").lean(),
    User.find({ _id: { $in: orders.map((row) => row.createdBy).filter(Boolean) }, companyId }).select("_id fullName employeeId").lean(),
  ]);
  const orderMap = new Map(orders.map((row) => [toId(row._id), row]));
  const accountMap = new Map(accounts.map((row) => [toId(row._id), row]));
  const userMap = new Map(creators.map((row) => [toId(row._id), { id: row._id, name: row.fullName, employeeId: row.employeeId || "" }]));
  const accessibleOrderIds = new Set(accessibleOrders.map((row) => toId(row._id)));
  return { events: events.map((event) => serializeEvent(event, { orders: orderMap, accounts: accountMap, users: userMap, accessibleOrderIds })), page, limit, total };
};

const listUnattributableEvents = async ({ companyId, user, filters = {} }) => {
  assertRole(user, MANAGEMENT_ROLES, "Data-quality events are restricted to Sales Head and Company Admin");
  return listAchievementEvents({ companyId, user, filters: { ...filters, quality: filters.quality || "UNATTRIBUTABLE" } });
};

const listCaptureFailures = async ({ companyId, user, filters = {} }) => {
  assertRole(user, RETRY_ROLES, "Achievement retry administration is restricted");
  const query = { companyId };
  if (filters.status) query.status = String(filters.status).toUpperCase();
  const rows = await SalesAchievementCaptureFailure.find(query).populate("orderId", "orderNumber createdAt grandTotal taxTotal").sort({ lastAttemptAt: -1 }).lean();
  return rows.map((row) => ({ ...row, order: row.orderId, orderId: row.orderId?._id || row.orderId }));
};

const retryCaptureFailure = async ({ companyId, failureId, user, req = null }) => {
  assertRole(user, RETRY_ROLES, "Achievement retry is restricted to Company Admin and Sales Head");
  if (!mongoose.Types.ObjectId.isValid(String(failureId || ""))) throw new ApiError(404, "Achievement capture failure not found");
  const failure = await SalesAchievementCaptureFailure.findOne({ _id: failureId, companyId });
  if (!failure) throw new ApiError(404, "Achievement capture failure not found");
  await writeAuditLog({ companyId, actorId: user._id, action: "SALES_ACHIEVEMENT_RETRY_REQUESTED", entityType: "SalesAchievementCaptureFailure", entityId: failure._id, metadata: { operationId: failure.operationId, sourceEntityId: failure.orderId, orderId: failure.orderId, attemptCount: failure.attemptCount + 1 }, req });
  const order = await Order.findOne({ _id: failure.orderId, companyId, deletedAt: null });
  if (!order) {
    failure.status = "OPEN"; failure.attemptCount += 1; failure.lastAttemptAt = new Date(); failure.errorCode = "ORDER_UNAVAILABLE"; failure.errorSummary = "Source Order is unavailable; retry remains unresolved"; await failure.save();
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_ACHIEVEMENT_RETRY_FAILED", entityType: "SalesAchievementCaptureFailure", entityId: failure._id, metadata: { operationId: failure.operationId, sourceEntityId: failure.orderId, orderId: failure.orderId, errorCode: failure.errorCode }, req });
    throw new ApiError(409, failure.errorSummary);
  }
  const items = await OrderItem.find({ companyId, parentType: "order", parentId: order._id });
  if (!items.length) {
    failure.status = "OPEN"; failure.attemptCount += 1; failure.lastAttemptAt = new Date(); failure.errorCode = "ORDER_ITEMS_MISSING"; failure.errorSummary = "Source Order has no line items"; await failure.save();
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_ACHIEVEMENT_RETRY_FAILED", entityType: "SalesAchievementCaptureFailure", entityId: failure._id, metadata: { operationId: failure.operationId, sourceEntityId: order._id, orderId: order._id, errorCode: failure.errorCode }, req });
    throw new ApiError(409, failure.errorSummary);
  }
  try {
    const result = await recordOrderCreatedAchievement({ companyId, order, orderItems: items, req });
    if (!["RECORDED", "ALREADY_RECORDED"].includes(result.status)) throw new ApiError(409, `Retry did not record achievement: ${result.status}`);
    failure.status = "RESOLVED"; failure.resolvedAt = new Date(); failure.resolvedBy = user._id; failure.lastAttemptAt = new Date(); failure.attemptCount += 1; failure.errorSummary = ""; await failure.save();
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_ACHIEVEMENT_RETRY_SUCCEEDED", entityType: "SalesAchievementCaptureFailure", entityId: failure._id, metadata: { operationId: failure.operationId, sourceEntityId: order._id, orderId: order._id, result: result.status }, req });
    return { failure: failure.toObject(), result };
  } catch (error) {
    failure.status = "OPEN"; failure.resolvedAt = null; failure.resolvedBy = null; failure.lastAttemptAt = new Date(); failure.attemptCount += 1; failure.errorCode = error.code || "RETRY_FAILED"; failure.errorSummary = String(error.message || "Retry failed").slice(0, 500); await failure.save();
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_ACHIEVEMENT_RETRY_FAILED", entityType: "SalesAchievementCaptureFailure", entityId: failure._id, metadata: { operationId: failure.operationId, sourceEntityId: order._id, orderId: order._id, errorCode: failure.errorCode }, req });
    throw error;
  }
};

const getLegacyOrderDiagnostic = async ({ companyId, user }) => {
  assertRole(user, MANAGEMENT_ROLES, "Legacy diagnostics are restricted to Sales Head and Company Admin");
  const policy = await CompanySalesPerformancePolicy.findOne({ companyId }).lean();
  if (!policy?.activationDate) return { activationDate: null, totalLegacyOrders: 0, legacyBookingAmount: 0, potentiallyAttributable: 0, unattributable: 0, accountTypeBreakdown: [], fsdEvidenceBreakdown: [], distributorChainEvidenceBreakdown: [], message: "Policy is not active" };
  const orders = await Order.find({ companyId, deletedAt: null, createdAt: { $lt: policy.activationDate } }).select("_id accountId sourceVisitId assignedTo grandTotal taxTotal createdAt").sort({ createdAt: -1 }).lean();
  const accountTypes = new Map(); const fsdEvidence = new Map(); const distributorEvidence = new Map();
  let legacyBookingAmount = 0; let potentiallyAttributable = 0; let unattributable = 0;
  for (const order of orders) {
    const items = await OrderItem.find({ companyId, parentType: "order", parentId: order._id }).select("lineSubtotal discountAmount").lean();
    legacyBookingAmount = roundMoney(legacyBookingAmount + calculateOrderBookingAmount(items, order).amount);
    const attribution = await resolveOrderAttribution({ companyId, order, occurredAt: new Date(order.createdAt) });
    const type = attribution.snapshot.sourceAccountType || "UNKNOWN"; accountTypes.set(type, (accountTypes.get(type) || 0) + 1);
    const fsd = attribution.snapshot.primaryFsdName || "NO_FSD_EVIDENCE"; fsdEvidence.set(fsd, (fsdEvidence.get(fsd) || 0) + 1);
    const distributor = attribution.snapshot.rootDistributorName || "NO_DISTRIBUTOR_CHAIN"; distributorEvidence.set(distributor, (distributorEvidence.get(distributor) || 0) + 1);
    if (attribution.confidence === "UNATTRIBUTABLE") unattributable += 1; else potentiallyAttributable += 1;
  }
  const rows = (map) => [...map.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { activationDate: policy.activationDate, totalLegacyOrders: orders.length, legacyBookingAmount, potentiallyAttributable, unattributable, accountTypeBreakdown: rows(accountTypes), fsdEvidenceBreakdown: rows(fsdEvidence), distributorChainEvidenceBreakdown: rows(distributorEvidence), message: "Read-only diagnostic; no legacy achievement events were created" };
};

const previewLegacyOrder = async ({ companyId, orderId, user }) => {
  assertRole(user, MANAGEMENT_ROLES, "Legacy reconciliation preview is restricted");
  if (!mongoose.Types.ObjectId.isValid(String(orderId || ""))) throw new ApiError(404, "Legacy Order not found");
  const policy = await CompanySalesPerformancePolicy.findOne({ companyId }).lean();
  if (!policy?.activationDate) throw new ApiError(409, "Sales performance policy has no activation boundary");
  const order = await Order.findOne({ _id: orderId, companyId, deletedAt: null, createdAt: { $lt: policy.activationDate } }).lean();
  if (!order) throw new ApiError(404, "Legacy Order not found");
  const items = await OrderItem.find({ companyId, parentType: "order", parentId: order._id }).lean();
  const calculation = calculateOrderBookingAmount(items, order);
  const attribution = await resolveOrderAttribution({ companyId, order, occurredAt: new Date(order.createdAt) });
  return { writePerformed: false, orderId: order._id, occurredAt: order.createdAt, bookingAmount: calculation.amount, confidence: attribution.confidence, proposedFsd: { id: attribution.snapshot.primaryFsdId, name: attribution.snapshot.primaryFsdName }, proposedDistributor: { id: attribution.snapshot.rootDistributorId, name: attribution.snapshot.rootDistributorName }, geography: attribution.snapshot, warnings: attribution.warnings };
};

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const toCsv = (columns, rows) => [columns.map((column) => csvEscape(column.label)).join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(","))].join("\r\n");
const flattenTree = (nodes, depth = 0) => nodes.flatMap((node) => [{ ...node, depth }, ...flattenTree(node.children || [], depth + 1)]);

const createPerformanceExport = async ({ companyId, user, type, filters = {} }) => {
  const exportType = String(type || "").toLowerCase();
  if (["target", "scorecard", "allocations"].includes(exportType)) {
    const dashboard = await getPerformanceDashboard({ companyId, user, filters });
    if (!dashboard.plan) return { filename: `target-performance-empty.csv`, csv: "Period,Owner Level,Owner Name,Target,Order Booking,Remaining,Achievement %,Currency\r\n" };
    const rows = flattenTree(dashboard.tree).map((node) => ({ period: dashboard.plan.periodKey, ownerLevel: node.owner.type, ownerName: node.owner.name, target: node.target, achievement: node.achievement, remaining: node.remaining, percentage: node.achievementPercentage == null ? "N/A" : node.achievementPercentage, allocated: node.allocated, unallocated: node.unallocated, currency: dashboard.plan.currency }));
    return { filename: `target-performance-${dashboard.plan.periodKey}.csv`, csv: toCsv([
      { key: "period", label: "Period" }, { key: "ownerLevel", label: "Owner Level" }, { key: "ownerName", label: "Owner Name" }, { key: "target", label: "Target" }, { key: "achievement", label: "Order Booking" }, { key: "remaining", label: "Remaining" }, { key: "percentage", label: "Achievement %" }, { key: "allocated", label: "Allocated" }, { key: "unallocated", label: "Unallocated" }, { key: "currency", label: "Currency" },
    ], rows) };
  }
  if (["achievements", "unattributable"].includes(exportType)) {
    if (exportType === "unattributable") assertRole(user, MANAGEMENT_ROLES, "Unattributable export is restricted");
    const result = await listAchievementEvents({ companyId, user, filters: { ...filters, ...(exportType === "unattributable" ? { quality: "UNATTRIBUTABLE" } : {}) }, internalLimit: 5000 });
    const rows = result.events.map((event) => ({ order: event.order.number, occurredAt: new Date(event.occurredAt).toISOString(), amount: event.amount, fsd: event.fsd.name, distributor: event.distributor.name, area: event.geography.area.name, branch: event.geography.branch.name, region: event.geography.region.name, zone: event.geography.zone.name, confidence: event.confidence, warnings: event.warnings.join(" | ") }));
    return { filename: `${exportType}.csv`, csv: toCsv([{ key: "order", label: "Order" }, { key: "occurredAt", label: "Occurred At" }, { key: "amount", label: "Order Booking" }, { key: "fsd", label: "FSD" }, { key: "distributor", label: "Distributor" }, { key: "area", label: "Area" }, { key: "branch", label: "Branch" }, { key: "region", label: "Region" }, { key: "zone", label: "Zone" }, { key: "confidence", label: "Confidence" }, { key: "warnings", label: "Warnings" }], rows) };
  }
  if (exportType === "comparison") {
    const comparison = await comparePlans({ companyId, planId: filters.planId, otherPlanId: filters.otherPlanId, user });
    const columns = [
      { key: "ownerType", label: "Owner Level" }, { key: "ownerName", label: "Owner Name" }, { key: "oldPath", label: "Old Geography Path" }, { key: "newPath", label: "New Geography Path" },
      { key: "oldTarget", label: "Old Target" }, { key: "newTarget", label: "New Target" },
      { key: "difference", label: "Difference" }, { key: "percentageDifference", label: "% Difference" },
      { key: "changeType", label: "Change Type" },
    ];
    const rows = comparison.rows.map((row) => ({
      ownerType: row.owner.type, ownerName: row.owner.name, oldPath: row.oldPath, newPath: row.newPath, oldTarget: row.oldTarget,
      newTarget: row.newTarget, difference: row.difference,
      percentageDifference: row.percentageDifference == null ? "N/A" : row.percentageDifference,
      changeType: row.changeType,
    }));
    return { filename: `target-comparison-v${comparison.oldPlan.version}-v${comparison.newPlan.version}.csv`, csv: toCsv(columns, rows) };
  }
  throw new ApiError(400, "Unsupported performance export type");
};

module.exports = {
  MANAGEMENT_ROLES, RETRY_ROLES, eventVisibilityFilter, aggregateAchievementByOwner, buildPerformanceTree,
  getPerformanceDashboard, createPlanRevision, listPlanRevisions, comparePlans, listAchievementEvents,
  listUnattributableEvents, listCaptureFailures, retryCaptureFailure, getLegacyOrderDiagnostic,
  previewLegacyOrder, csvEscape, toCsv, createPerformanceExport,
};
