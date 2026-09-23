const mongoose = require("mongoose");
const User = require("../models/User");
const Visit = require("../models/Visit");
const VisitLocationPoint = require("../models/VisitLocationPoint");
const Lead = require("../models/Lead");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Account = require("../models/Account");
const Attendance = require("../models/Attendance");
const FollowUp = require("../models/FollowUp");
const ApiError = require("../utils/ApiError");
const {
  resolveSalesVisibilityContext,
} = require("./salesVisibility.service");

const REPORT_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];

const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

const parseDateBoundary = (value, { endExclusive = false } = {}) => {
  if (!value) return null;
  const text = String(value);
  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (endExclusive) date.setDate(date.getDate() + 1);
    return date;
  }
  return new Date(value);
};

const getDateRange = ({ dateFrom, dateTo } = {}) => {
  const now = new Date();
  const from = dateFrom ? parseDateBoundary(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = dateTo ? parseDateBoundary(dateTo, { endExclusive: true }) : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ApiError(400, "Invalid date range");
  }
  return { from, to };
};

const periodFilter = (field, range) => ({
  [field]: { $gte: range.from, $lt: range.to },
});

const getSalesManagers = async (companyId, salesHeadId = null) => {
  const query = {
    companyId,
    $or: [{ role: "sales_manager" }, { systemRole: "sales_manager" }],
    status: "active",
    deletedAt: null,
  };
  if (salesHeadId) query.reportingManagerId = salesHeadId;
  return User.find(query)
    .select("_id companyId fullName email role systemRole designationId")
    .populate("designationId", "hierarchyLevel mappedRole status isArchived")
    .lean();
};

const getCompanyExecutives = async (companyId) =>
  User.find({
    companyId,
    $or: [
      { role: { $in: ["sales_executive", "sales"] } },
      { systemRole: { $in: ["sales_executive", "sales"] } },
    ],
    status: "active",
    deletedAt: null,
  })
    .select("_id fullName email reportingManagerId")
    .lean();

const todayAttendance = async (employeeIds, companyId) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return Attendance.find({
    companyId,
    employeeId: { $in: employeeIds },
    date: { $gte: start, $lt: end },
    deletedAt: null,
  })
    .select("employeeId punchStatus punchInAt punchOutAt")
    .lean();
};

const visitStats = async (companyId, executiveIds, range) => {
  const match = {
    companyId: toObjectId(companyId),
    executiveId: { $in: executiveIds.map(toObjectId) },
    ...periodFilter("startedAt", range),
  };
  const [row] = await Visit.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        exceeded: { $sum: { $cond: [{ $eq: ["$durationStatus", "exceeded"] }, 1, 0] } },
        withinLimit: { $sum: { $cond: [{ $eq: ["$durationStatus", "within_limit"] }, 1, 0] } },
        avgDurationSeconds: { $avg: "$durationSeconds" },
      },
    },
  ]);

  return {
    total: row?.total || 0,
    completed: row?.completed || 0,
    exceeded: row?.exceeded || 0,
    withinLimit: row?.withinLimit || 0,
    avgDurationMinutes: Math.round(((row?.avgDurationSeconds || 0) / 60) * 100) / 100,
  };
};

const leadStats = async (companyId, executiveIds, range) => {
  const base = {
    companyId,
    assignedTo: { $in: executiveIds },
    deletedAt: null,
  };
  const [total, created, converted] = await Promise.all([
    Lead.countDocuments(base),
    Lead.countDocuments({ ...base, ...periodFilter("createdAt", range) }),
    Lead.countDocuments({ ...base, convertedAt: { $ne: null }, ...periodFilter("convertedAt", range) }),
  ]);
  return { total, created, converted, pending: Math.max(0, total - converted) };
};

const orderStats = async (companyId, executiveIds, range) => {
  const match = {
    companyId: toObjectId(companyId),
    assignedTo: { $in: executiveIds.map(toObjectId) },
    deletedAt: null,
    ...periodFilter("createdAt", range),
  };
  const [row] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        value: { $sum: "$grandTotal" },
        pending: { $sum: { $cond: [{ $eq: ["$orderStatus", null] }, 1, 0] } },
      },
    },
  ]);
  return {
    total: row?.total || 0,
    value: Math.round((row?.value || 0) * 100) / 100,
    pending: row?.pending || 0,
    confirmed: Math.max(0, (row?.total || 0) - (row?.pending || 0)),
  };
};

const followUpStats = async (companyId, executiveIds, range) => {
  const base = {
    companyId,
    assignedTo: { $in: executiveIds },
    deletedAt: null,
  };
  const now = new Date();
  const [due, overdue, completed] = await Promise.all([
    FollowUp.countDocuments({ ...base, status: "pending", scheduledAt: { $gte: range.from, $lt: range.to } }),
    FollowUp.countDocuments({ ...base, status: "pending", scheduledAt: { $lt: now } }),
    FollowUp.countDocuments({ ...base, status: "completed", completedAt: { $gte: range.from, $lt: range.to } }),
  ]);
  return { due, overdue, completed };
};

const getExecutiveDashboard = async (executiveId, companyId, query = {}) => {
  const range = getDateRange(query);
  const executiveIds = [executiveId];
  const [visits, leads, orders, followUps, activeVisit, attendance, lastVisit] = await Promise.all([
    visitStats(companyId, executiveIds, range),
    leadStats(companyId, executiveIds, range),
    orderStats(companyId, executiveIds, range),
    followUpStats(companyId, executiveIds, range),
    Visit.findOne({ companyId, executiveId, status: "started" }).select("_id startedAt").lean(),
    todayAttendance(executiveIds, companyId),
    Visit.findOne({ companyId, executiveId, endedAt: { $ne: null } }).sort({ endedAt: -1 }).select("endedAt").lean(),
  ]);

  return {
    visits,
    leads,
    orders,
    followUps,
    todayActivity: {
      punched_in: attendance[0]?.punchStatus === "PUNCHED_IN",
      activeVisit,
      lastVisitEndedAt: lastVisit?.endedAt || null,
    },
  };
};

const getManagerDashboard = async (user, companyId, query = {}) => {
  const range = getDateRange(query);
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const scopedIds = visibility.accessibleEmployeeIds || [];
  const executives = await User.find({
    _id: { $in: scopedIds.filter((id) => String(id) !== String(user._id)) },
    companyId,
    role: { $in: ["sales_manager", "sales_executive", "sales"] },
    status: "active",
    deletedAt: null,
  }).select("_id fullName email role reportingManagerId").lean();
  const executiveIds = executives.map((user) => user._id);
  const attendanceRows = await todayAttendance(executiveIds, companyId);
  const attendanceByUser = new Map(attendanceRows.map((row) => [String(row.employeeId), row]));

  const rows = [];
  for (const executive of executives) {
    const [visits, leads, orders, activeVisit, lastVisit] = await Promise.all([
      visitStats(companyId, [executive._id], range),
      leadStats(companyId, [executive._id], range),
      orderStats(companyId, [executive._id], range),
      Visit.findOne({ companyId, executiveId: executive._id, status: "started" }).select("_id").lean(),
      Visit.findOne({ companyId, executiveId: executive._id }).sort({ startedAt: -1 }).select("startedAt endedAt").lean(),
    ]);
    rows.push({
      executiveId: executive._id,
      name: executive.fullName,
      visits: { total: visits.total, exceeded: visits.exceeded },
      leads: { total: leads.created, created: leads.created, converted: leads.converted, allTime: leads.total },
      orders: { count: orders.total, value: orders.value },
      lastActivity: lastVisit?.endedAt || lastVisit?.startedAt || null,
      isPunchedIn: attendanceByUser.get(String(executive._id))?.punchStatus === "PUNCHED_IN",
      activeVisitId: activeVisit?._id || null,
    });
  }

  const [missedFollowUps, exceededVisits] = await Promise.all([
    getMissedFollowups(companyId, { executiveIds }),
    getExceededVisits(companyId, { executiveIds, range }),
  ]);

  return {
    visibility: {
      status: visibility.status,
      hierarchyLevel: visibility.hierarchyLevel,
      scopeType: visibility.scopeType,
      geographyName: visibility.geographyName,
      areaCount: visibility.descendantAreaIds.length,
      employeeCount: visibility.accessibleEmployeeIds.length,
    },
    teamSize: executives.length,
    executives: rows,
    teamTotals: {
      visits: rows.reduce((sum, row) => sum + row.visits.total, 0),
      leads: rows.reduce((sum, row) => sum + row.leads.created, 0),
      orders: rows.reduce((sum, row) => sum + row.orders.count, 0),
      revenue: Math.round(rows.reduce((sum, row) => sum + row.orders.value, 0) * 100) / 100,
    },
    missedFollowUps,
    exceededVisits,
  };
};

const getHeadDashboard = async (salesHeadId, companyId, query = {}) => {
  const range = getDateRange(query);
  const [managers, executives, productPerformance, dealerCoverage, distributorSummary] = await Promise.all([
    getSalesManagers(companyId, salesHeadId),
    getCompanyExecutives(companyId),
    getProductPerformance(companyId, { range }),
    getDealerCoverage(companyId, { range }),
    getDistributorRevenue(companyId, { range }),
  ]);

  const managerRows = [];
  for (const manager of managers) {
    const ids = await scopeExecutiveIds(manager, companyId);
    const team = ids.filter((id) => String(id) !== String(manager._id));
    const [visits, leads, orders] = await Promise.all([
      visitStats(companyId, ids, range),
      leadStats(companyId, ids, range),
      orderStats(companyId, ids, range),
    ]);
    managerRows.push({
      managerId: manager._id,
      name: manager.fullName,
      teamSize: team.length,
      revenue: orders.value,
      visits: visits.total,
      leads: leads.total,
      orders: orders.total,
    });
  }

  const topExecutives = [];
  for (const executive of executives) {
    const [visits, leads, orders] = await Promise.all([
      visitStats(companyId, [executive._id], range),
      leadStats(companyId, [executive._id], range),
      orderStats(companyId, [executive._id], range),
    ]);
    topExecutives.push({
      executiveId: executive._id,
      name: executive.fullName,
      revenue: orders.value,
      visits: visits.total,
      leads: leads.total,
    });
  }

  const achieved = managerRows.reduce((sum, row) => sum + row.revenue, 0);
  const target = 0;
  return {
    managers: managerRows,
    topExecutives: topExecutives.sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    productPerformance,
    dealerCoverage,
    distributorSummary,
    targetVsAchievement: {
      target,
      achieved,
      percentageAchieved: target ? Math.round((achieved / target) * 10000) / 100 : 0,
    },
  };
};

const scopeExecutiveIds = async (user, companyId, requestedExecutiveId = null) => {
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const ids = visibility.accessibleEmployeeIds || [];
  if (!requestedExecutiveId) return ids;
  return ids.some((id) => String(id) === String(requestedExecutiveId))
    ? [requestedExecutiveId]
    : [];
};

const getVisitsReport = async (companyId, user, query = {}) => {
  const range = getDateRange(query);
  const executiveIds = await scopeExecutiveIds(user, companyId, query.executiveId);
  const filter = {
    companyId,
    executiveId: { $in: executiveIds },
    ...periodFilter("startedAt", range),
  };
  if (query.durationStatus) filter.durationStatus = query.durationStatus;
  if (query.visitTypeId) filter.visitTypeId = query.visitTypeId;
  return Visit.find(filter).populate("visitTypeId", "name code").populate("executiveId", "fullName email").sort({ startedAt: -1 }).lean();
};

const getVisitDurationReport = async (companyId, user, query = {}) => {
  const range = getDateRange(query);
  const executiveIds = await scopeExecutiveIds(user, companyId, query.executiveId);
  return Visit.aggregate([
    {
      $match: {
        companyId: toObjectId(companyId),
        executiveId: { $in: executiveIds.map(toObjectId) },
        ...periodFilter("startedAt", range),
      },
    },
    { $group: { _id: "$durationStatus", count: { $sum: 1 }, avgSeconds: { $avg: "$durationSeconds" } } },
  ]);
};

const getVisitTypeDistribution = async (companyId, user, query = {}) => {
  const range = getDateRange(query);
  const executiveIds = await scopeExecutiveIds(user, companyId, query.executiveId);
  return Visit.aggregate([
    {
      $match: {
        companyId: toObjectId(companyId),
        executiveId: { $in: executiveIds.map(toObjectId) },
        ...periodFilter("startedAt", range),
      },
    },
    {
      $group: {
        _id: "$visitTypeId",
        count: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        exceeded: { $sum: { $cond: [{ $eq: ["$durationStatus", "exceeded"] }, 1, 0] } },
        avgDurationSeconds: { $avg: "$durationSeconds" },
      },
    },
    {
      $lookup: {
        from: "visittypes",
        localField: "_id",
        foreignField: "_id",
        as: "visitType",
      },
    },
    { $unwind: { path: "$visitType", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        visitTypeId: "$_id",
        name: { $ifNull: ["$visitType.name", "Unassigned"] },
        code: "$visitType.code",
        count: 1,
        completed: 1,
        exceeded: 1,
        avgDurationMinutes: { $round: [{ $divide: [{ $ifNull: ["$avgDurationSeconds", 0] }, 60] }, 2] },
      },
    },
    { $sort: { count: -1, name: 1 } },
  ]);
};

const getDealerCoverage = async (companyId, { range = getDateRange({}), notVisitedInDays = 30, executiveIds = null, accountIds = null } = {}) => {
  const dealerQuery = { companyId, deletedAt: null, $or: [{ accountType: /dealer/i }, { parentRelationshipType: "dealer" }] };
  if (accountIds) dealerQuery._id = { $in: accountIds };
  const dealers = await Account.find(dealerQuery).select("_id name").lean();
  const dealerIds = dealers.map((dealer) => dealer._id);
  const visitQuery = {
    companyId,
    entityType: { $in: ["Dealer", "Account", "Customer"] },
    entityId: { $in: dealerIds },
    ...periodFilter("startedAt", range),
  };
  if (executiveIds) visitQuery.executiveId = { $in: executiveIds };
  const visitedRows = await Visit.distinct("entityId", visitQuery);
  return {
    totalDealers: dealers.length,
    visitedThisPeriod: visitedRows.length,
    notVisitedInDays,
    notVisited: Math.max(0, dealers.length - visitedRows.length),
  };
};

const getDistributorRevenue = async (companyId, { range = getDateRange({}), executiveIds = null } = {}) => {
  const distributors = await Account.find({
    companyId,
    deletedAt: null,
    $or: [{ accountType: /distributor/i }, { parentRelationshipType: "distributor" }],
  }).select("_id name").lean();

  const rows = [];
  for (const distributor of distributors) {
    const dealers = await Account.find({ companyId, parentAccountId: distributor._id, deletedAt: null }).select("_id").lean();
    const accountIds = [distributor._id, ...dealers.map((dealer) => dealer._id)];
    const match = { companyId: toObjectId(companyId), accountId: { $in: accountIds.map(toObjectId) }, deletedAt: null, ...periodFilter("createdAt", range) };
    if (executiveIds) match.assignedTo = { $in: executiveIds.map(toObjectId) };
    const [orderRow] = await Order.aggregate([
      { $match: match },
      { $group: { _id: null, revenue: { $sum: "$grandTotal" }, orders: { $sum: 1 } } },
    ]);
    rows.push({
      distributorId: distributor._id,
      name: distributor.name,
      dealerCount: dealers.length,
      revenue: orderRow?.revenue || 0,
      orders: orderRow?.orders || 0,
    });
  }
  return rows;
};

const getProductPerformance = async (companyId, { range = getDateRange({}), executiveIds = null } = {}) => {
  let orderIds = null;
  if (executiveIds) {
    const orders = await Order.find({
      companyId,
      assignedTo: { $in: executiveIds },
      deletedAt: null,
      ...periodFilter("createdAt", range),
    }).select("_id").lean();
    orderIds = orders.map((order) => order._id);
  }

  const match = { companyId: toObjectId(companyId), parentType: "order", createdAt: { $gte: range.from, $lt: range.to } };
  if (orderIds) match.parentId = { $in: orderIds.map(toObjectId) };

  return OrderItem.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$productId",
        name: { $first: "$productNameSnapshot" },
        quantity: { $sum: "$quantity" },
        revenue: { $sum: "$lineTotal" },
      },
    },
    { $sort: { revenue: -1 } },
    { $project: { _id: 0, productId: "$_id", name: 1, quantity: 1, revenue: 1 } },
  ]);
};

const getLeadConversion = async (companyId, user, query = {}) => {
  const range = getDateRange(query);
  const executiveIds = await scopeExecutiveIds(user, companyId, query.executiveId);
  const rows = await Lead.aggregate([
    {
      $match: {
        companyId: toObjectId(companyId),
        assignedTo: { $in: executiveIds.map(toObjectId) },
        deletedAt: null,
        ...periodFilter("createdAt", range),
      },
    },
    {
      $group: {
        _id: "$leadTypeId",
        total: { $sum: 1 },
        converted: { $sum: { $cond: [{ $ne: ["$convertedAt", null] }, 1, 0] } },
      },
    },
  ]);
  return rows.map((row) => ({
    leadTypeId: row._id,
    total: row.total,
    converted: row.converted,
    conversionRate: row.total ? Math.round((row.converted / row.total) * 10000) / 100 : 0,
  }));
};

const getMissedFollowups = async (companyId, { executiveIds = null } = {}) => {
  const query = { companyId, deletedAt: null, convertedAt: null, nextActionAt: { $lt: new Date() } };
  if (executiveIds) query.assignedTo = { $in: executiveIds };
  return Lead.find(query).select("_id assignedTo nextActionAt").sort({ nextActionAt: 1 }).lean()
    .then((leads) => leads.map((lead) => ({ leadId: lead._id, executiveId: lead.assignedTo, dueDate: lead.nextActionAt })));
};

const getExceededVisits = async (companyId, { executiveIds = null, range = getDateRange({}) } = {}) => {
  const query = { companyId, durationStatus: "exceeded", ...periodFilter("startedAt", range) };
  if (executiveIds) query.executiveId = { $in: executiveIds };
  return Visit.find(query).select("_id executiveId durationSeconds expectedDurationMinutes").lean()
    .then((visits) => visits.map((visit) => ({
      visitId: visit._id,
      executiveId: visit.executiveId,
      durationMinutes: Math.round((Number(visit.durationSeconds || 0) / 60) * 100) / 100,
      expectedMinutes: visit.expectedDurationMinutes,
    })));
};

const getDiscountSummary = async (companyId, user, query = {}) => {
  const range = getDateRange(query);
  const executiveIds = await scopeExecutiveIds(user, companyId, query.executiveId);
  const orders = await Order.find({
    companyId,
    assignedTo: { $in: executiveIds },
    deletedAt: null,
    ...periodFilter("createdAt", range),
  }).select("_id").lean();
  const orderIds = orders.map((order) => order._id);

  return OrderItem.find({
    companyId,
    parentType: "order",
    parentId: { $in: orderIds },
    $or: [{ discountAmount: { $gt: 0 } }, { approvalStatus: { $ne: "not_required" } }],
    createdAt: { $gte: range.from, $lt: range.to },
  }).sort({ createdAt: -1 }).lean();
};

const getTeamLiveLocations = async (user, companyId) => {
  const scopedIds = await scopeExecutiveIds(user, companyId);
  const members = await User.find({
    _id: { $in: scopedIds.filter((id) => String(id) !== String(user._id)) },
    companyId,
    role: { $in: ["sales_manager", "sales_executive", "sales"] },
    status: "active",
    deletedAt: null,
  }).select("_id fullName email role reportingManagerId").lean();

  const attendanceRows = await todayAttendance(members.map((member) => member._id), companyId);
  const attendanceByUser = new Map(attendanceRows.map((row) => [String(row.employeeId), row]));
  const response = [];

  for (const member of members) {
    const [lastLocation, activeVisit, lastVisit] = await Promise.all([
      VisitLocationPoint.findOne({ companyId, executiveId: member._id }).sort({ recordedAt: -1 }).lean(),
      Visit.findOne({ companyId, executiveId: member._id, status: "started" }).populate("visitTypeId", "name code").lean(),
      Visit.findOne({ companyId, executiveId: member._id }).sort({ startedAt: -1 }).select("startedAt endedAt").lean(),
    ]);
    response.push({
      executiveId: member._id,
      name: member.fullName,
      isPunchedIn: attendanceByUser.get(String(member._id))?.punchStatus === "PUNCHED_IN",
      activeVisit: activeVisit
        ? {
            visitId: activeVisit._id,
            entityName: String(activeVisit.entityId),
            visitType: activeVisit.visitTypeId?.name || "",
            startedAt: activeVisit.startedAt,
            durationSoFar: Math.round((Date.now() - new Date(activeVisit.startedAt).getTime()) / 1000),
          }
        : null,
      lastLocation: lastLocation
        ? { latitude: lastLocation.latitude, longitude: lastLocation.longitude, recordedAt: lastLocation.recordedAt }
        : null,
      lastActivityAt: lastVisit?.endedAt || lastVisit?.startedAt || lastLocation?.recordedAt || null,
    });
  }

  return response;
};

const summarizeUserActivity = async (companyId, executiveIds, range) => {
  const [visits, leads, orders, followUps] = await Promise.all([
    visitStats(companyId, executiveIds, range),
    leadStats(companyId, executiveIds, range),
    orderStats(companyId, executiveIds, range),
    followUpStats(companyId, executiveIds, range),
  ]);

  return {
    visits,
    leads,
    orders,
    followUps,
  };
};

const getSalesActivityTeam = async (user, companyId, query = {}) => {
  const range = getDateRange(query);
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const scopedIds = visibility.accessibleEmployeeIds || [];
  const scopedUsers = await User.find({
    _id: { $in: scopedIds.filter((id) => String(id) !== String(user._id)) },
    companyId,
    role: { $in: ["sales_manager", "sales_executive", "sales"] },
    status: "active",
    deletedAt: null,
  }).select("_id fullName email role").lean();
  const members = [];
  for (const member of scopedUsers) {
    members.push({
      userId: member._id,
      name: member.fullName || member.email || "Sales Employee",
      email: member.email,
      role: member.role,
      scope: "employee",
      summary: await summarizeUserActivity(companyId, [member._id], range),
    });
  }
  return {
    members,
    visibility: {
      status: visibility.status,
      hierarchyLevel: visibility.hierarchyLevel,
      scopeType: visibility.scopeType,
      geographyName: visibility.geographyName,
      areaCount: visibility.descendantAreaIds.length,
      employeeCount: visibility.accessibleEmployeeIds.length,
    },
  };
};

const resolveActivityTarget = async (user, companyId, targetUserId) => {
  if (!targetUserId) throw new ApiError(400, "targetUserId is required");

  const scopedIds = await scopeExecutiveIds(user, companyId);
  if (!scopedIds.some((id) => String(id) === String(targetUserId))) {
    throw new ApiError(404, "Sales user not found");
  }

  const target = await User.findOne({ _id: targetUserId, companyId, status: "active", deletedAt: null })
    .select("_id fullName email role reportingManagerId")
    .lean();
  if (!target) throw new ApiError(404, "Sales user not found");

  return { target, executiveIds: [target._id], scope: "employee" };
};

const getSalesUserActivity = async (user, companyId, targetUserId, query = {}) => {
  const range = getDateRange(query);
  const { target, executiveIds, scope, executives = [] } = await resolveActivityTarget(user, companyId, targetUserId);
  const visibleIds = await scopeExecutiveIds(user, companyId);
  const assignableExecutives = await User.find({
    _id: { $in: visibleIds },
    companyId,
    role: { $in: ["sales_executive", "sales"] },
    status: "active",
    deletedAt: null,
  }).select("_id fullName email role").lean();
  const summary = await summarizeUserActivity(companyId, executiveIds, range);

  const [followUps, leads, visits, orders] = await Promise.all([
    FollowUp.find({
      companyId,
      assignedTo: { $in: executiveIds },
      deletedAt: null,
      ...periodFilter("scheduledAt", range),
    })
      .populate("assignedTo", "fullName email role")
      .populate("leadId", "name companyName phone")
      .populate("accountId", "name phone city assignedTo")
      .sort({ scheduledAt: -1 })
      .limit(100)
      .lean(),
    Lead.find({
      companyId,
      assignedTo: { $in: executiveIds },
      deletedAt: null,
      ...periodFilter("createdAt", range),
    })
      .populate("assignedTo", "fullName email role")
      .populate("leadTypeId", "name code")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
    Visit.find({
      companyId,
      executiveId: { $in: executiveIds },
      ...periodFilter("startedAt", range),
    })
      .populate("executiveId", "fullName email role")
      .populate("visitTypeId", "name code expectedDurationMinutes")
      .sort({ startedAt: -1 })
      .limit(100)
      .lean(),
    Order.find({
      companyId,
      assignedTo: { $in: executiveIds },
      deletedAt: null,
      ...periodFilter("createdAt", range),
    })
      .populate("assignedTo", "fullName email role")
      .populate("accountId", "name phone city")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);

  return {
    target: {
      userId: target._id,
      name: target.fullName || target.email || "Sales User",
      email: target.email,
      role: target.role,
      scope,
      teamSize: executives.length,
    },
    assignableExecutives: assignableExecutives
      .filter((member) => ["sales_executive", "sales"].includes(member.role))
      .map((member) => ({
        userId: member._id,
        name: member.fullName || member.email || "Sales Executive",
        email: member.email,
      })),
    range: { from: range.from, to: range.to },
    summary,
    followUps,
    leads,
    visits,
    orders,
  };
};

module.exports = {
  REPORT_ROLES,
  getDateRange,
  scopeExecutiveIds,
  getExecutiveDashboard,
  getManagerDashboard,
  getHeadDashboard,
  getVisitsReport,
  getVisitDurationReport,
  getVisitTypeDistribution,
  getDealerCoverage,
  getDistributorRevenue,
  getProductPerformance,
  getLeadConversion,
  getMissedFollowups,
  getDiscountSummary,
  getTeamLiveLocations,
  getSalesActivityTeam,
  getSalesUserActivity,
};
