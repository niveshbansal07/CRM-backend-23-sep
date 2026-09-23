const mongoose = require("mongoose");
const Company = require("../models/Company");
const User = require("../models/User");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const DistributorSalesAssignment = require("../models/DistributorSalesAssignment");
const Account = require("../models/Account");
const CompanySalesPerformancePolicy = require("../models/CompanySalesPerformancePolicy");
const SalesTargetPlan = require("../models/SalesTargetPlan");
const SalesTargetAllocation = require("../models/SalesTargetAllocation");
const Order = require("../models/Order");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const { SALES_PERFORMANCE, OWNER_TYPES, OWNER_CHILDREN } = require("../constants/salesPerformance");
const { assertMoney, moneyDecimal, moneyNumber, roundMoney, resolveMonthPeriod } = require("../utils/salesPerformance");
const { resolveSalesVisibilityContext, resolveAccessibleAccountScope } = require("./salesVisibility.service");
const { sumAchievementEvents } = require("./salesAchievement.service");
const { writeAuditLog } = require("./auditLog.service");

const TARGET_READ_ROLES = ["super_admin", "company_admin", "sales_head", "sales_manager", "sales_executive"];
const HEAD_WRITE_ROLES = ["super_admin", "sales_head"];
const REVIEW_ROLES = ["super_admin", "company_admin"];
const toId = (value) => String(value?._id || value?.id || value || "");
const roleFor = (user) => getAccessRole(user);
const assertRole = (user, roles, message = "Sales target access denied") => {
  const role = roleFor(user);
  if (!roles.includes(role)) throw new ApiError(403, message);
  return role;
};
const assertObjectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) throw new ApiError(400, `${label} is invalid`);
  return value;
};
const inSession = (query, session) => session && query?.session ? query.session(session) : query;

const serializeAllocation = (row) => {
  const item = row?.toObject ? row.toObject() : { ...row };
  item.targetValue = moneyNumber(item.targetValue);
  item.allocatedValue = moneyNumber(item.allocatedValue);
  item.unallocatedValue = moneyNumber(item.unallocatedValue);
  return item;
};

const validateAllocationTotals = ({ parentTarget, childTargets }) => {
  const target = assertMoney(parentTarget, "Parent target");
  const allocated = roundMoney((childTargets || []).reduce((sum, value) => sum + assertMoney(value, "Child target"), 0));
  return { target, allocated, unallocated: roundMoney(target - allocated), valid: allocated <= target, overAllocatedBy: roundMoney(Math.max(0, allocated - target)) };
};

const assertTransition = (from, to) => {
  const allowed = { DRAFT: ["SUBMITTED"], SUBMITTED: ["ACTIVE", "REJECTED"], ACTIVE: ["SUPERSEDED"], REJECTED: [], SUPERSEDED: [] };
  if (!allowed[from]?.includes(to)) throw new ApiError(409, `Invalid target plan transition ${from} -> ${to}`);
  return true;
};

const getPlan = async (companyId, planId, { writable = false, session = null } = {}) => {
  assertObjectId(planId, "Plan ID");
  const plan = await inSession(SalesTargetPlan.findOne({ _id: planId, companyId }), session);
  if (!plan) throw new ApiError(404, "Sales target plan not found");
  if (writable && plan.status !== "DRAFT") throw new ApiError(409, "Only DRAFT target plans can be edited");
  return plan;
};

const resolveOwner = async ({ companyId, ownerType, ownerId, parent, session = null }) => {
  if (!OWNER_TYPES.includes(ownerType)) throw new ApiError(400, "Unsupported target owner type");
  assertObjectId(ownerId, "Owner ID");
  if (!parent) {
    if (ownerType !== "COMPANY" || toId(ownerId) !== toId(companyId)) throw new ApiError(400, "Plan root must be the company target");
    const company = await inSession(Company.findById(companyId).select("name slug"), session).lean();
    if (!company) throw new ApiError(404, "Company not found");
    return { name: company.name, code: company.slug || "" };
  }
  if (!OWNER_CHILDREN[parent.ownerType]?.includes(ownerType)) throw new ApiError(400, `${ownerType} cannot be allocated below ${parent.ownerType}`);
  if (["ZONE", "REGION", "BRANCH", "AREA"].includes(ownerType)) {
    const geography = await inSession(SalesGeography.findOne({ _id: ownerId, companyId, type: ownerType, status: "active", isActive: true, isArchived: { $ne: true }, deletedAt: null }), session).lean();
    if (!geography) throw new ApiError(404, `Active ${ownerType} not found`);
    if (toId(geography.parentId) !== toId(parent.ownerId)) throw new ApiError(400, `${ownerType} is outside its parent target`);
    return { name: geography.name, code: geography.code || "" };
  }
  if (ownerType === "EMPLOYEE_FSD") {
    const employee = await inSession(User.findOne({ _id: ownerId, companyId, status: "active", deletedAt: null }).populate("designationId", "hierarchyLevel mappedRole").select("fullName employeeId designationId"), session).lean();
    if (!employee || Number(employee.designationId?.hierarchyLevel) !== 1) throw new ApiError(404, "Active structured L1/FSD not found");
    const assignment = await inSession(SalesEmployeeGeographyAssignment.findOne({ companyId, employeeId: ownerId, hierarchyLevel: 1, geographyId: parent.ownerId, status: "current", isCurrent: true, deletedAt: null }), session).lean();
    if (!assignment) throw new ApiError(400, "FSD is not currently assigned to the parent Area");
    return { name: employee.fullName, code: employee.employeeId || "" };
  }
  if (ownerType === "DISTRIBUTOR") {
    const mapping = await inSession(DistributorSalesAssignment.findOne({ companyId, distributorAccountId: ownerId, primaryFsdId: parent.ownerId, status: "current", isCurrent: true, deletedAt: null }), session).lean();
    if (!mapping) throw new ApiError(400, "Distributor is not currently mapped to the parent FSD");
    const account = await inSession(Account.findOne({ _id: ownerId, companyId, status: { $ne: "inactive" }, deletedAt: null }).select("name distributorBusinessId"), session).lean();
    if (!account) throw new ApiError(404, "Active Distributor not found");
    return { name: account.name, code: account.distributorBusinessId || "" };
  }
  throw new ApiError(400, "Invalid target owner hierarchy");
};

const createPlan = async ({ companyId, user, payload = {}, req = null }) => {
  assertRole(user, HEAD_WRITE_ROLES, "Only Sales Head can create target plans");
  const policy = await CompanySalesPerformancePolicy.findOne({ companyId, status: "ACTIVE" }).lean();
  if (!policy) throw new ApiError(409, "Activate the company sales performance policy before creating targets");
  const targetValue = assertMoney(payload.targetValue, "Company target");
  const period = resolveMonthPeriod({ year: payload.year, month: payload.month, timezone: policy.timezone, fiscalStartMonth: policy.fiscalStartMonth });
  const periodQuery = { companyId, metricCode: SALES_PERFORMANCE.METRIC_CODE, periodStart: period.periodStart, periodEndExclusive: period.periodEndExclusive };
  const session = await mongoose.startSession();
  session.startTransaction();
  let plan;
  try {
    const latest = await inSession(SalesTargetPlan.findOne(periodQuery).sort({ version: -1 }), session).lean();
    const inFlight = await inSession(SalesTargetPlan.exists({ ...periodQuery, status: { $in: ["DRAFT", "SUBMITTED"] } }), session);
    if (inFlight) throw new ApiError(409, "A draft or submitted target plan already exists for this month");
    const version = Number(latest?.version || 0) + 1;
    [plan] = await SalesTargetPlan.create([{
      companyId, ...period, metricCode: SALES_PERFORMANCE.METRIC_CODE, metricLabel: SALES_PERFORMANCE.METRIC_LABEL,
      currency: policy.baseCurrency, timezone: policy.timezone, policyVersion: policy.policyVersion, version,
      revisionOfPlanId: latest?._id || null, status: "DRAFT", createdBy: user._id, updatedBy: user._id,
    }], { session });
    const owner = await resolveOwner({ companyId, ownerType: "COMPANY", ownerId: companyId, parent: null, session });
    await SalesTargetAllocation.create([{ companyId, planId: plan._id, parentAllocationId: null, ownerType: "COMPANY", ownerId: companyId, ownerNameSnapshot: owner.name, ownerCodeSnapshot: owner.code, targetValue: moneyDecimal(targetValue), allocatedValue: moneyDecimal(0), unallocatedValue: moneyDecimal(targetValue), createdBy: user._id, updatedBy: user._id }], { session });
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_TARGET_PLAN_CREATED", entityType: "SalesTargetPlan", entityId: plan._id, metadata: { periodKey: plan.periodKey, targetValue, version }, req, session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000) throw new ApiError(409, "A target plan revision was created concurrently; refresh and retry");
    throw error;
  } finally {
    await session.endSession();
  }
  return getPlanDetail({ companyId, planId: plan._id, user });
};

const recalculateParent = async (companyId, parentAllocationId, userId, session = null) => {
  if (!parentAllocationId) return null;
  const parent = await inSession(SalesTargetAllocation.findOne({ _id: parentAllocationId, companyId }), session);
  const children = await inSession(SalesTargetAllocation.find({ companyId, planId: parent.planId, parentAllocationId }), session);
  const totals = validateAllocationTotals({ parentTarget: parent.targetValue, childTargets: children.map((child) => child.targetValue) });
  if (!totals.valid) throw new ApiError(409, `Child targets exceed parent by ${totals.overAllocatedBy.toFixed(2)}`);
  parent.allocatedValue = moneyDecimal(totals.allocated);
  parent.unallocatedValue = moneyDecimal(totals.unallocated);
  parent.updatedBy = userId;
  await parent.save({ session });
  return parent;
};

const saveAllocation = async ({ companyId, planId, user, payload = {}, req = null }) => {
  assertRole(user, HEAD_WRITE_ROLES, "Only Sales Head can allocate targets");
  const session = await mongoose.startSession();
  session.startTransaction();
  let plan;
  try {
    plan = await getPlan(companyId, planId, { writable: true, session });
    const parent = await inSession(SalesTargetAllocation.findOne({ _id: payload.parentAllocationId, companyId, planId: plan._id }), session);
    if (!parent) throw new ApiError(404, "Parent target allocation not found");
    const ownerType = String(payload.ownerType || "").toUpperCase();
    const owner = await resolveOwner({ companyId, ownerType, ownerId: payload.ownerId, parent, session });
    const targetValue = assertMoney(payload.targetValue, "Target value");
    const existing = await inSession(SalesTargetAllocation.findOne({ companyId, planId: plan._id, ownerType, ownerId: payload.ownerId }), session);
    if (existing && toId(existing.parentAllocationId) !== toId(parent._id)) throw new ApiError(409, "Owner already exists under another target parent");
    const children = await inSession(SalesTargetAllocation.find({ companyId, planId: plan._id, parentAllocationId: parent._id, ...(existing ? { _id: { $ne: existing._id } } : {}) }), session).lean();
    const totals = validateAllocationTotals({ parentTarget: parent.targetValue, childTargets: [...children.map((row) => row.targetValue), targetValue] });
    if (!totals.valid) throw new ApiError(409, `Child targets exceed parent by ${totals.overAllocatedBy.toFixed(2)}`);
    if (existing) {
      const ownChildren = await inSession(SalesTargetAllocation.find({ companyId, planId: plan._id, parentAllocationId: existing._id }), session).lean();
      const ownTotals = validateAllocationTotals({ parentTarget: targetValue, childTargets: ownChildren.map((row) => row.targetValue) });
      if (!ownTotals.valid) throw new ApiError(409, "New target is below the amount already allocated to children");
      existing.targetValue = moneyDecimal(targetValue); existing.unallocatedValue = moneyDecimal(ownTotals.unallocated); existing.allocatedValue = moneyDecimal(ownTotals.allocated);
      existing.ownerNameSnapshot = owner.name; existing.ownerCodeSnapshot = owner.code; existing.updatedBy = user._id;
      await existing.save({ session });
    } else {
      await SalesTargetAllocation.create([{ companyId, planId: plan._id, parentAllocationId: parent._id, ownerType, ownerId: payload.ownerId, ownerNameSnapshot: owner.name, ownerCodeSnapshot: owner.code, targetValue: moneyDecimal(targetValue), allocatedValue: moneyDecimal(0), unallocatedValue: moneyDecimal(targetValue), createdBy: user._id, updatedBy: user._id }], { session });
    }
    await recalculateParent(companyId, parent._id, user._id, session);
    plan.updatedBy = user._id; await plan.save({ session });
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_TARGET_ALLOCATION_SAVED", entityType: "SalesTargetPlan", entityId: plan._id, metadata: { ownerType, ownerId: String(payload.ownerId), targetValue }, req, session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.errorLabels?.includes("TransientTransactionError")) throw new ApiError(409, "Target allocation changed concurrently; refresh and retry");
    throw error;
  } finally {
    await session.endSession();
  }
  return getPlanDetail({ companyId, planId: plan._id, user });
};

const removeAllocation = async ({ companyId, planId, allocationId, user, req = null }) => {
  assertRole(user, HEAD_WRITE_ROLES, "Only Sales Head can remove target allocations");
  assertObjectId(allocationId, "Allocation ID");
  const session = await mongoose.startSession();
  session.startTransaction();
  let plan;
  try {
    plan = await getPlan(companyId, planId, { writable: true, session });
    const allocation = await inSession(SalesTargetAllocation.findOne({ _id: allocationId, companyId, planId: plan._id }), session);
    if (!allocation) throw new ApiError(404, "Target allocation not found");
    if (!allocation.parentAllocationId || allocation.ownerType === "COMPANY") throw new ApiError(409, "The company target cannot be removed");
    const hasChildren = await inSession(SalesTargetAllocation.exists({ companyId, planId: plan._id, parentAllocationId: allocation._id }), session);
    if (hasChildren) throw new ApiError(409, "Remove child allocations before removing this target owner");
    const parentAllocationId = allocation.parentAllocationId;
    const removed = { ownerType: allocation.ownerType, ownerId: String(allocation.ownerId), ownerName: allocation.ownerNameSnapshot, targetValue: moneyNumber(allocation.targetValue) };
    await SalesTargetAllocation.deleteOne({ _id: allocation._id, companyId, planId: plan._id }, { session });
    await recalculateParent(companyId, parentAllocationId, user._id, session);
    plan.updatedBy = user._id;
    await plan.save({ session });
    await writeAuditLog({ companyId, actorId: user._id, action: "SALES_TARGET_ALLOCATION_REMOVED", entityType: "SalesTargetPlan", entityId: plan._id, metadata: removed, req, session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.errorLabels?.includes("TransientTransactionError")) throw new ApiError(409, "Target allocation changed concurrently; refresh and retry");
    throw error;
  } finally {
    await session.endSession();
  }
  return getPlanDetail({ companyId, planId: plan._id, user });
};

const buildPreview = (plan, allocations) => {
  const blockers = [];
  const warnings = [];
  const byParent = new Map();
  allocations.forEach((row) => { const key = toId(row.parentAllocationId); byParent.set(key, [...(byParent.get(key) || []), row]); });
  for (const parent of allocations) {
    const children = byParent.get(toId(parent._id)) || [];
    if (!children.length) continue;
    const totals = validateAllocationTotals({ parentTarget: parent.targetValue, childTargets: children.map((row) => row.targetValue) });
    if (!totals.valid) blockers.push({ code: "OVER_ALLOCATED", allocationId: parent._id, amount: totals.overAllocatedBy });
    if (totals.unallocated > 0) warnings.push({ code: "UNDER_ALLOCATED", allocationId: parent._id, amount: totals.unallocated });
  }
  const root = allocations.find((row) => row.ownerType === "COMPANY" && !row.parentAllocationId);
  if (!root) blockers.push({ code: "MISSING_COMPANY_TARGET" });
  return { planId: plan._id, status: plan.status, valid: blockers.length === 0, blockers, warnings, allocationCount: allocations.length, companyTarget: root ? moneyNumber(root.targetValue) : 0 };
};

const previewPlan = async ({ companyId, planId, user, session = null }) => {
  assertRole(user, TARGET_READ_ROLES);
  const plan = await getPlan(companyId, planId, { session });
  const allocations = await inSession(SalesTargetAllocation.find({ companyId, planId: plan._id }), session).lean();
  const preview = buildPreview(plan, allocations);
  const byId = new Map(allocations.map((row) => [toId(row._id), row]));
  for (const allocation of allocations) {
    const parent = allocation.parentAllocationId ? byId.get(toId(allocation.parentAllocationId)) : null;
    try {
      await resolveOwner({ companyId, ownerType: allocation.ownerType, ownerId: allocation.ownerId, parent, session });
    } catch (error) {
      const message = String(error.message || "Owner validation failed");
      const code = /not currently assigned|not currently mapped|outside its parent/i.test(message)
        ? "OWNER_CURRENT_GEOGRAPHY_CHANGED"
        : /active .* not found|not found/i.test(message)
          ? "OWNER_INACTIVE"
          : "OWNER_REVIEW_REQUIRED";
      preview.blockers.push({ code, legacyCode: "OWNER_MAPPING_CHANGED", allocationId: allocation._id, message, reviewRequired: true });
    }
  }
  preview.valid = preview.blockers.length === 0;
  return preview;
};

const transitionPlan = async ({ companyId, planId, user, action, reason = "", req = null }) => {
  const desired = { submit: "SUBMITTED", approve: "ACTIVE", reject: "REJECTED" }[action];
  if (!desired) throw new ApiError(400, "Unsupported target plan action");
  if (action === "submit") assertRole(user, HEAD_WRITE_ROLES, "Only Sales Head can submit targets");
  else assertRole(user, REVIEW_ROLES, "Only Company Admin can approve or reject targets");
  const session = await mongoose.startSession();
  session.startTransaction();
  let plan;
  try {
    plan = await getPlan(companyId, planId, { session });
    assertTransition(plan.status, desired);
    if (action !== "reject") {
      const preview = await previewPlan({ companyId, planId, user, session });
      if (!preview.valid) throw new ApiError(409, "Target plan has blocking validation errors");
    }
    if (action === "reject" && !String(reason || "").trim()) throw new ApiError(400, "Rejection reason is required");
    const now = new Date();
    if (desired === "ACTIVE") await SalesTargetPlan.updateMany({ companyId, metricCode: plan.metricCode, periodStart: plan.periodStart, periodEndExclusive: plan.periodEndExclusive, status: "ACTIVE", _id: { $ne: plan._id } }, { $set: { status: "SUPERSEDED", updatedBy: user._id } }, { session });
    plan.status = desired; plan.updatedBy = user._id;
    if (desired === "SUBMITTED") { plan.submittedAt = now; plan.submittedBy = user._id; }
    if (desired === "ACTIVE") { plan.approvedAt = now; plan.approvedBy = user._id; }
    if (desired === "REJECTED") { plan.rejectedAt = now; plan.rejectedBy = user._id; plan.rejectionReason = String(reason).trim(); }
    await plan.save({ session });
    await writeAuditLog({ companyId, actorId: user._id, action: `SALES_TARGET_PLAN_${desired}`, entityType: "SalesTargetPlan", entityId: plan._id, metadata: { reason: plan.rejectionReason || "", version: plan.version }, req, session });
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000 || error?.errorLabels?.includes("TransientTransactionError")) throw new ApiError(409, "Target plan changed concurrently; refresh and retry");
    throw error;
  } finally {
    await session.endSession();
  }
  return getPlanDetail({ companyId, planId: plan._id, user });
};

const buildAllocationScope = async (companyId, user) => {
  const role = roleFor(user);
  if (["super_admin", "company_admin", "sales_head"].includes(role)) return null;
  const context = await resolveSalesVisibilityContext({ user, companyId });
  const accounts = await resolveAccessibleAccountScope(context);
  const ors = [];
  const geographyTypesByLevel = { 2: ["AREA"], 3: ["BRANCH", "AREA"], 4: ["REGION", "BRANCH", "AREA"], 5: ["ZONE", "REGION", "BRANCH", "AREA"] };
  const geographyTypes = geographyTypesByLevel[context.hierarchyLevel] || [];
  if (geographyTypes.length && context.allGeographyIds?.length) ors.push({ ownerType: { $in: geographyTypes }, ownerId: { $in: context.allGeographyIds } });
  if (context.accessibleEmployeeIds?.length) ors.push({ ownerType: "EMPLOYEE_FSD", ownerId: { $in: context.hierarchyLevel === 1 ? [context.employeeId] : context.accessibleEmployeeIds } });
  if (accounts.distributorIds?.length) ors.push({ ownerType: "DISTRIBUTOR", ownerId: { $in: accounts.distributorIds } });
  return ors.length ? { $or: ors } : { _id: "000000000000000000000000" };
};

const listPlans = async ({ companyId, user, filters = {} }) => {
  assertRole(user, TARGET_READ_ROLES);
  const query = { companyId, metricCode: SALES_PERFORMANCE.METRIC_CODE };
  const role = roleFor(user);
  if (!["super_admin", "company_admin", "sales_head"].includes(role)) query.status = "ACTIVE";
  if (filters.status && ["super_admin", "company_admin", "sales_head"].includes(role)) query.status = String(filters.status).toUpperCase();
  return SalesTargetPlan.find(query).sort({ periodStart: -1, version: -1 }).lean();
};

const getPlanDetail = async ({ companyId, planId, user, includePerformance = false }) => {
  assertRole(user, TARGET_READ_ROLES);
  const plan = await getPlan(companyId, planId);
  const role = roleFor(user);
  if (!["super_admin", "company_admin", "sales_head"].includes(role) && plan.status !== "ACTIVE") throw new ApiError(404, "Active target plan not found");
  const scope = await buildAllocationScope(companyId, user);
  const query = { companyId, planId: plan._id, ...(scope || {}) };
  const rows = await SalesTargetAllocation.find(query).sort({ createdAt: 1 }).lean();
  const allocations = [];
  for (const row of rows) {
    const item = serializeAllocation(row);
    if (includePerformance || plan.status === "ACTIVE") {
      const achieved = await sumAchievementEvents({ companyId, periodStart: plan.periodStart, periodEndExclusive: plan.periodEndExclusive, ownerType: row.ownerType, ownerId: row.ownerId });
      item.achievement = achieved.achievement;
      item.unattributable = achieved.unattributable;
      item.remaining = roundMoney(item.targetValue - item.achievement);
      item.percentage = item.targetValue > 0 ? roundMoney((item.achievement / item.targetValue) * 100) : null;
    }
    allocations.push(item);
  }
  return { plan: plan.toObject(), allocations, preview: buildPreview(plan, rows) };
};

const getOwnerOptions = async ({ companyId, planId, parentAllocationId, user }) => {
  assertRole(user, HEAD_WRITE_ROLES);
  await getPlan(companyId, planId, { writable: true });
  const parent = await SalesTargetAllocation.findOne({ _id: parentAllocationId, companyId, planId }).lean();
  if (!parent) throw new ApiError(404, "Parent target allocation not found");
  const nextType = OWNER_CHILDREN[parent.ownerType]?.[0];
  let rows = [];
  if (["ZONE", "REGION", "BRANCH", "AREA"].includes(nextType)) rows = await SalesGeography.find({ companyId, type: nextType, ...(nextType === "ZONE" ? {} : { parentId: parent.ownerId }), status: "active", isActive: true, isArchived: { $ne: true }, deletedAt: null }).select("_id name code").sort({ name: 1 }).lean();
  else if (nextType === "EMPLOYEE_FSD") {
    const assignments = await SalesEmployeeGeographyAssignment.find({ companyId, hierarchyLevel: 1, geographyId: parent.ownerId, status: "current", isCurrent: true, deletedAt: null }).select("employeeId").lean();
    rows = await User.find({ _id: { $in: assignments.map((row) => row.employeeId) }, companyId, status: "active", deletedAt: null }).select("_id fullName employeeId").sort({ fullName: 1 }).lean();
    rows = rows.map((row) => ({ _id: row._id, name: row.fullName, code: row.employeeId || "" }));
  } else if (nextType === "DISTRIBUTOR") {
    const mappings = await DistributorSalesAssignment.find({ companyId, primaryFsdId: parent.ownerId, status: "current", isCurrent: true, deletedAt: null }).select("distributorAccountId").lean();
    rows = await Account.find({ _id: { $in: mappings.map((row) => row.distributorAccountId) }, companyId, deletedAt: null }).select("_id name distributorBusinessId").sort({ name: 1 }).lean();
    rows = rows.map((row) => ({ _id: row._id, name: row.name, code: row.distributorBusinessId || "" }));
  }
  return { ownerType: nextType, options: rows.map((row) => ({ id: row._id, name: row.name, code: row.code || "" })) };
};

const getLegacyDiagnostic = async ({ companyId, user }) => {
  assertRole(user, ["super_admin", "company_admin", "sales_head"]);
  const policy = await CompanySalesPerformancePolicy.findOne({ companyId }).lean();
  if (!policy?.activationDate) return { activationDate: null, legacyOrderCount: 0, message: "Policy is not active" };
  const legacyOrderCount = await Order.countDocuments({ companyId, deletedAt: null, createdAt: { $lt: policy.activationDate } });
  return { activationDate: policy.activationDate, legacyOrderCount, message: "Legacy orders are diagnostic only and are not auto-backfilled" };
};

module.exports = { TARGET_READ_ROLES, HEAD_WRITE_ROLES, REVIEW_ROLES, roleFor, assertRole, getPlan, resolveOwner, buildAllocationScope, serializeAllocation, validateAllocationTotals, assertTransition, buildPreview, createPlan, saveAllocation, removeAllocation, previewPlan, transitionPlan, listPlans, getPlanDetail, getOwnerOptions, getLegacyDiagnostic };
