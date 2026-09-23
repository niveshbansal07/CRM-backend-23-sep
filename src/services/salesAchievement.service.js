const mongoose = require("mongoose");
const CompanySalesPerformancePolicy = require("../models/CompanySalesPerformancePolicy");
const SalesAchievementEvent = require("../models/SalesAchievementEvent");
const OrderItem = require("../models/OrderItem");
const Account = require("../models/Account");
const CrmMaster = require("../models/CrmMaster");
const Visit = require("../models/Visit");
const User = require("../models/User");
const SalesGeography = require("../models/SalesGeography");
const SalesEmployeeGeographyAssignment = require("../models/SalesEmployeeGeographyAssignment");
const DistributorSalesAssignment = require("../models/DistributorSalesAssignment");
const SalesAchievementCaptureFailure = require("../models/SalesAchievementCaptureFailure");
const env = require("../config/env");
const { SALES_PERFORMANCE } = require("../constants/salesPerformance");
const { moneyDecimal, moneyNumber, roundMoney } = require("../utils/salesPerformance");
const { writeAuditLog } = require("./auditLog.service");

const effectiveAt = (occurredAt) => ({ effectiveFrom: { $lte: occurredAt }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: occurredAt } }], deletedAt: null });
const inSession = (query, session) => session && query?.session ? query.session(session) : query;

const calculateOrderBookingAmount = (items = [], order = {}) => {
  const itemAmount = roundMoney(items.reduce((sum, item) => sum + Number(item.lineSubtotal || 0) - Number(item.discountAmount || 0), 0));
  const headerAmount = roundMoney(Number(order.grandTotal || 0) - Number(order.taxTotal || 0));
  return { amount: itemAmount, headerAmount, difference: roundMoney(Math.abs(itemAmount - headerAmount)), consistent: Math.abs(itemAmount - headerAmount) <= 0.05 };
};

const loadAccountChain = async (companyId, accountId, session = null) => {
  const chain = [];
  const seen = new Set();
  let nextId = accountId;
  while (nextId && chain.length < 5 && !seen.has(String(nextId))) {
    seen.add(String(nextId));
    const row = await inSession(Account.findOne({ _id: nextId, companyId, deletedAt: null }).select("_id name accountTypeId distributorBusinessId parentAccountId"), session).lean();
    if (!row) break;
    chain.push(row);
    nextId = row.parentAccountId;
  }
  const typeIds = chain.map((row) => row.accountTypeId).filter(Boolean);
  const types = await inSession(CrmMaster.find({ _id: { $in: typeIds }, companyId, module: "account", type: "account_type" }).select("_id code"), session).lean();
  const byId = new Map(types.map((row) => [String(row._id), String(row.code || "").toUpperCase()]));
  return chain.map((row) => ({ ...row, accountTypeCode: byId.get(String(row.accountTypeId)) || "" }));
};

const loadL1Assignment = async (companyId, employeeId, occurredAt, session = null) => {
  if (!employeeId) return null;
  const user = await inSession(User.findOne({ _id: employeeId, companyId, status: "active", deletedAt: null }).populate("designationId", "hierarchyLevel mappedRole").select("_id fullName designationId role systemRole"), session).lean();
  if (!user || Number(user.designationId?.hierarchyLevel) !== 1) return null;
  const assignment = await inSession(SalesEmployeeGeographyAssignment.findOne({ companyId, employeeId, hierarchyLevel: 1, assignmentType: "PRIMARY", ...effectiveAt(occurredAt) }).sort({ effectiveFrom: -1 }), session).lean();
  return assignment ? { user, assignment } : null;
};

const loadGeographyChain = async (companyId, areaId, session = null) => {
  const result = {};
  let id = areaId;
  for (let depth = 0; id && depth < 4; depth += 1) {
    const geo = await inSession(SalesGeography.findOne({ _id: id, companyId, deletedAt: null }).select("_id type name code parentId"), session).lean();
    if (!geo) break;
    result[geo.type.toLowerCase()] = geo;
    id = geo.parentId;
  }
  return result;
};

const resolveOrderAttribution = async ({ companyId, order, occurredAt, session = null }) => {
  const warnings = [];
  const chain = await loadAccountChain(companyId, order.accountId, session);
  const source = chain[0] || null;
  const distributor = chain.find((row) => row.accountTypeCode === "DISTRIBUTOR") || null;
  let l1 = null;
  let attributionSource = "";
  if (order.sourceVisitId) {
    const visit = await inSession(Visit.findOne({ _id: order.sourceVisitId, companyId }).select("executiveId"), session).lean();
    l1 = await loadL1Assignment(companyId, visit?.executiveId, occurredAt, session);
    if (l1) attributionSource = "SOURCE_VISIT_EXECUTIVE";
    else if (visit) warnings.push("Source Visit executive was not a valid L1 at event time");
  }
  if (!l1) {
    l1 = await loadL1Assignment(companyId, order.assignedTo, occurredAt, session);
    if (l1) attributionSource = "ORDER_ASSIGNED_TO";
    else if (order.assignedTo) warnings.push("Order assignee was not a valid L1 at event time");
  }
  const distributorAssignment = distributor ? await inSession(DistributorSalesAssignment.findOne({ companyId, distributorAccountId: distributor._id, ...effectiveAt(occurredAt) }).sort({ effectiveFrom: -1 }), session).lean() : null;
  if (!l1 && distributorAssignment) {
    l1 = await loadL1Assignment(companyId, distributorAssignment.primaryFsdId, occurredAt, session);
    if (l1) attributionSource = "DISTRIBUTOR_PRIMARY_FSD";
  }
  const areaId = l1?.assignment?.geographyId || distributorAssignment?.geographyId || null;
  const geography = areaId ? await loadGeographyChain(companyId, areaId, session) : {};
  if (!distributor) warnings.push("Account hierarchy did not resolve to a Distributor");
  if (!l1) warnings.push("No valid L1 attribution source resolved at event time");
  const confidence = !l1 ? "UNATTRIBUTABLE" : attributionSource === "DISTRIBUTOR_PRIMARY_FSD" ? "INFERRED" : "EXACT";
  return {
    confidence, rollupEligible: confidence !== "UNATTRIBUTABLE", warnings,
    snapshot: {
      sourceAccountId: source?._id || order.accountId, sourceAccountType: source?.accountTypeCode || "",
      rootDistributorId: distributor?._id || null, rootDistributorName: distributor?.name || "", rootDistributorCode: distributor?.distributorBusinessId || "",
      distributorAssignmentId: distributorAssignment?._id || null,
      primaryFsdId: l1?.user?._id || null, primaryFsdName: l1?.user?.fullName || "", employeeAssignmentId: l1?.assignment?._id || null,
      areaId: geography.area?._id || null, areaName: geography.area?.name || "", areaCode: geography.area?.code || "",
      branchId: geography.branch?._id || null, branchName: geography.branch?.name || "", branchCode: geography.branch?.code || "",
      regionId: geography.region?._id || null, regionName: geography.region?.name || "", regionCode: geography.region?.code || "",
      zoneId: geography.zone?._id || null, zoneName: geography.zone?.name || "", zoneCode: geography.zone?.code || "",
      attributionSource, warnings,
    },
  };
};

const recordOrderCreatedAchievement = async ({ companyId, order, orderItems = null, req = null }) => {
  if (!env.salesAchievementCaptureEnabled) return { status: "SKIPPED_CAPTURE_DISABLED" };
  const occurredAt = new Date(order.createdAt || Date.now());
  const eligiblePolicy = await CompanySalesPerformancePolicy.exists({ companyId, status: "ACTIVE", activationDate: { $lte: occurredAt } });
  if (!eligiblePolicy) return { status: "SKIPPED_NO_ACTIVE_POLICY" };
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const policy = await inSession(CompanySalesPerformancePolicy.findOne({ companyId, status: "ACTIVE", activationDate: { $lte: occurredAt } }), session).lean();
    if (!policy) {
      await session.commitTransaction();
      return { status: "SKIPPED_NO_ACTIVE_POLICY" };
    }
    const existing = await inSession(SalesAchievementEvent.findOne({ companyId, sourceType: "ORDER", sourceId: order._id, sourceEvent: "ORDER_CREATED", sourceEventVersion: 1 }), session).lean();
    if (existing) {
      await session.commitTransaction();
      return { status: "ALREADY_RECORDED", eventId: existing._id };
    }
    const items = orderItems || await inSession(OrderItem.find({ companyId, parentType: "order", parentId: order._id }), session).lean();
    const calculation = calculateOrderBookingAmount(items, order);
    const attribution = await resolveOrderAttribution({ companyId, order, occurredAt, session });
    if (!calculation.consistent) attribution.warnings.push(`Order line/header ex-tax difference ${calculation.difference.toFixed(2)}`);
    attribution.snapshot.warnings = attribution.warnings;
    const dataQuality = attribution.confidence === "UNATTRIBUTABLE" ? "UNATTRIBUTABLE" : attribution.warnings.length ? "WARNING" : "VALID";
    const [event] = await SalesAchievementEvent.create([{
      companyId, sourceType: "ORDER", sourceId: order._id, sourceEvent: "ORDER_CREATED", sourceEventVersion: 1,
      operationId: new mongoose.Types.ObjectId(), occurredAt, metricCode: SALES_PERFORMANCE.METRIC_CODE,
      amount: moneyDecimal(calculation.amount), currency: policy.baseCurrency, policyVersion: policy.policyVersion,
      confidence: attribution.confidence, rollupEligible: attribution.rollupEligible, dataQuality, snapshot: attribution.snapshot,
    }], { session });
    await writeAuditLog({ companyId, actorId: order.createdBy || null, action: "SALES_ACHIEVEMENT_RECORDED", entityType: "SalesAchievementEvent", entityId: event._id, metadata: { sourceId: String(order._id), amount: calculation.amount, confidence: attribution.confidence }, req, session });
    await SalesAchievementCaptureFailure.updateOne(
      { companyId, orderId: order._id, sourceEvent: "ORDER_CREATED", sourceEventVersion: 1, status: "OPEN" },
      { $set: { status: "RESOLVED", resolvedAt: new Date(), errorSummary: "" } },
      { session }
    );
    await session.commitTransaction();
    return { status: "RECORDED", eventId: event._id, amount: calculation.amount, confidence: attribution.confidence, dataQuality };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    if (error?.code === 11000) return { status: "ALREADY_RECORDED" };
    throw error;
  } finally {
    await session.endSession();
  }
};

const sumAchievementEvents = async ({ companyId, periodStart, periodEndExclusive, ownerType, ownerId }) => {
  const match = { companyId: new mongoose.Types.ObjectId(String(companyId)), metricCode: SALES_PERFORMANCE.METRIC_CODE, occurredAt: { $gte: periodStart, $lt: periodEndExclusive } };
  if (ownerType !== "COMPANY") {
    match.rollupEligible = true;
    match[`snapshot.${({ ZONE: 'zoneId', REGION: 'regionId', BRANCH: 'branchId', AREA: 'areaId', EMPLOYEE_FSD: 'primaryFsdId', DISTRIBUTOR: 'rootDistributorId' })[ownerType]}`] = new mongoose.Types.ObjectId(String(ownerId));
  }
  const rows = await SalesAchievementEvent.aggregate([
    { $match: match },
    { $group: { _id: null, achievement: { $sum: { $cond: [{ $eq: ["$rollupEligible", true] }, "$amount", { $toDecimal: "0" }] } }, unattributable: { $sum: { $cond: [{ $eq: ["$rollupEligible", false] }, "$amount", { $toDecimal: "0" }] } } } },
  ]);
  return { achievement: moneyNumber(rows[0]?.achievement), unattributable: ownerType === "COMPANY" ? moneyNumber(rows[0]?.unattributable) : 0 };
};

module.exports = { effectiveAt, calculateOrderBookingAmount, resolveOrderAttribution, recordOrderCreatedAchievement, sumAchievementEvents };
