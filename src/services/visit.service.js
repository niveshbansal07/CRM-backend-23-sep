const Visit = require("../models/Visit");
const VisitLocationPoint = require("../models/VisitLocationPoint");
const VisitType = require("../models/VisitType");
const Lead = require("../models/Lead");
const Account = require("../models/Account");
const User = require("../models/User");
const FollowUp = require("../models/FollowUp");
const ApiError = require("../utils/ApiError");
const { createOrder } = require("./order.service");
const {
  andFilters,
  resolveSalesVisibilityContext,
  buildLeadVisibilityFilter,
  buildVisitVisibilityFilter,
  assertAccountWithinVisibility,
} = require("./salesVisibility.service");

const ACTIVE_STATUS = "started";
const VIEW_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];
const START_ROLES = ["sales_head", "sales_manager", "sales_executive", "sales"];
const APPROVER_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager"];

const assertCompanyId = (companyId) => {
  if (!companyId) throw new ApiError(400, "Company context is required");
};

const toRadians = (value) => (Number(value) * Math.PI) / 180;

const calculateDistanceMetres = (aLat, aLng, bLat, bLng) => {
  if ([aLat, aLng, bLat, bLng].some((value) => value === null || value === undefined || Number.isNaN(Number(value)))) {
    return null;
  }

  const earthRadius = 6371000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
};

const resolveSalesHeadId = async (user) => {
  let current = user;
  const visited = new Set();

  while (current?.reportingManagerId && !visited.has(String(current.reportingManagerId))) {
    visited.add(String(current.reportingManagerId));
    const manager = await User.findOne({
      _id: current.reportingManagerId,
      companyId: current.companyId,
      deletedAt: null,
    })
      .select("_id role systemRole accessRole reportingManagerId")
      .lean();

    if (!manager) return null;
    const role = manager.systemRole || manager.role;
    if (role === "sales_head") return manager._id;
    current = manager;
  }

  return null;
};

const getEntityLocation = async (entityType, entityId, companyId, user = null) => {
  if (entityType === "Lead") {
    const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
    const lead = await Lead.findOne(andFilters(
      { _id: entityId, companyId, deletedAt: null },
      visibility ? buildLeadVisibilityFilter(visibility) : {}
    )).lean();
    if (!lead) throw new ApiError(404, "Lead not found");
    return {
      latitude: lead.creationLatitude ?? lead.geoLocation?.lat ?? null,
      longitude: lead.creationLongitude ?? lead.geoLocation?.lng ?? null,
    };
  }

  if (user) {
    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    await assertAccountWithinVisibility({ context: visibility, accountId: entityId, companyId });
  }
  const account = await Account.findOne({ _id: entityId, companyId, deletedAt: null }).lean();
  if (!account) throw new ApiError(404, "Account not found");
  return {
    latitude: account.latitude ?? null,
    longitude: account.longitude ?? null,
  };
};

const loadVisitType = async (visitTypeId, companyId) => {
  const visitType = await VisitType.findOne({ _id: visitTypeId, companyId, isActive: true }).lean();
  if (!visitType) throw new ApiError(404, "Active visit type not found");
  return visitType;
};

const getActiveVisit = async (executiveId, companyId) => {
  assertCompanyId(companyId);
  return Visit.findOne({ executiveId, companyId, status: ACTIVE_STATUS })
    .populate(
      "visitTypeId",
      "name code allowedEntityTypes expectedDurationMinutes requiresOutcome requiresNextFollowUp requiresProductDiscussion requiresPhoto requiresCheckOutLocation"
    )
    .sort({ startedAt: -1 })
    .lean();
};

const createLocationPoint = async (visit, data, source) => {
  if (data.latitude === undefined || data.longitude === undefined) return null;

  return VisitLocationPoint.create({
    companyId: visit.companyId,
    visitId: visit._id,
    executiveId: visit.executiveId,
    latitude: data.latitude,
    longitude: data.longitude,
    accuracy: data.accuracy ?? null,
    speed: data.speed ?? null,
    heading: data.heading ?? null,
    batteryLevel: data.batteryLevel ?? null,
    isMockLocationSuspected: Boolean(data.isMockLocationSuspected),
    recordedAt: data.recordedAt || new Date(),
    source,
  });
};

const startVisit = async (executiveId, companyId, data, user = null) => {
  assertCompanyId(companyId);

  const existing = await getActiveVisit(executiveId, companyId);
  if (existing) throw new ApiError(400, "You already have an active visit");

  const visitType = await loadVisitType(data.visitTypeId, companyId);
  if (!visitType.allowedEntityTypes.includes(data.entityType)) {
    throw new ApiError(400, `Visit type does not allow ${data.entityType} visits`);
  }

  if (visitType.requiresCheckInLocation && (data.checkInLatitude === undefined || data.checkInLongitude === undefined)) {
    throw new ApiError(400, "Check-in location is required to start this visit");
  }

  const executive = await User.findOne({ _id: executiveId, companyId, deletedAt: null }).select(
    "_id companyId reportingManagerId managerId role systemRole"
  );
  if (!executive) throw new ApiError(404, "Executive not found");

  const entityLocation = await getEntityLocation(data.entityType, data.entityId, companyId, user || executive);
  const distanceFromEntityMetres = calculateDistanceMetres(
    data.checkInLatitude,
    data.checkInLongitude,
    entityLocation.latitude,
    entityLocation.longitude
  );

  const visit = await Visit.create({
    companyId,
    visitTypeId: data.visitTypeId,
    entityType: data.entityType,
    entityId: data.entityId,
    executiveId,
    reportingManagerId: executive.reportingManagerId || executive.managerId || null,
    salesHeadId: await resolveSalesHeadId(executive),
    attendanceSessionId: data.attendanceSessionId || null,
    startedAt: new Date(),
    expectedDurationMinutes: visitType.expectedDurationMinutes,
    checkInLatitude: data.checkInLatitude,
    checkInLongitude: data.checkInLongitude,
    checkInAccuracy: data.checkInAccuracy ?? null,
    distanceFromEntityMetres,
    visitPurposeId: data.visitPurposeId || null,
    isMockLocationSuspected: Boolean(data.isMockLocationSuspected),
    createdBy: executiveId,
    updatedBy: executiveId,
    status: ACTIVE_STATUS,
  });

  await createLocationPoint(
    visit,
    {
      latitude: data.checkInLatitude,
      longitude: data.checkInLongitude,
      accuracy: data.checkInAccuracy,
      isMockLocationSuspected: data.isMockLocationSuspected,
    },
    "check_in"
  );

  return { visit, message: "Visit started" };
};

const validateEndRequirements = (visitType, data) => {
  if (visitType.requiresOutcome && !data.visitOutcomeId) {
    throw new ApiError(400, "Outcome is required to complete this visit");
  }
  if (visitType.requiresNextFollowUp && !data.nextFollowUpAt) {
    throw new ApiError(400, "Next follow-up date is required");
  }
  if (visitType.requiresPhoto && (!Array.isArray(data.photos) || data.photos.length === 0)) {
    throw new ApiError(400, "At least one photo is required");
  }
  if (
    visitType.requiresProductDiscussion &&
    (!Array.isArray(data.productsDiscussed) || data.productsDiscussed.length === 0)
  ) {
    throw new ApiError(400, "Products discussed is required");
  }
};

const createVisitFollowUp = async (visit) => {
  if (!visit.nextFollowUpAt) return null;

  return FollowUp.create({
    companyId: visit.companyId,
    leadId: visit.entityType === "Lead" ? visit.entityId : visit.leadCreatedId || null,
    accountId: visit.entityType !== "Lead" ? visit.entityId : null,
    visitId: visit._id,
    relatedVisitId: visit._id,
    scheduledAt: visit.nextFollowUpAt,
    assignedTo: visit.executiveId,
    followUpType: "call",
    title: `Follow-up scheduled at end of visit: ${visit.visitNumber || visit._id}`,
    source: "visit_end",
    priority: "normal",
    note: `Follow-up scheduled at end of visit: ${visit.visitNumber || visit._id}`,
    notes: `Follow-up scheduled at end of visit: ${visit.visitNumber || visit._id}`,
    createdBy: visit.executiveId,
    updatedBy: visit.executiveId,
  });
};

const endVisit = async (visitId, executiveId, companyId, data, user = null) => {
  assertCompanyId(companyId);

  const visit = await Visit.findOne({ _id: visitId, executiveId, companyId });
  if (!visit) throw new ApiError(404, "Active visit not found");
  if (visit.status !== ACTIVE_STATUS) throw new ApiError(400, "Only started visits can be ended");

  const visitType = await loadVisitType(visit.visitTypeId, companyId);
  validateEndRequirements(visitType, data);

  if (visitType.requiresCheckOutLocation && (data.checkOutLatitude === undefined || data.checkOutLongitude === undefined)) {
    throw new ApiError(400, "Check-out location is required to complete this visit");
  }

  visit.endedAt = new Date();
  visit.checkOutLatitude = data.checkOutLatitude;
  visit.checkOutLongitude = data.checkOutLongitude;
  visit.checkOutAccuracy = data.checkOutAccuracy ?? null;
  visit.visitOutcomeId = data.visitOutcomeId || null;
  visit.notes = data.notes || visit.notes;
  visit.nextFollowUpAt = data.nextFollowUpAt || null;
  visit.productsDiscussed = Array.isArray(data.productsDiscussed) ? data.productsDiscussed : [];
  visit.photos = Array.isArray(data.photos) ? data.photos : [];
  visit.documents = Array.isArray(data.documents) ? data.documents : visit.documents;
  visit.isMockLocationSuspected = visit.isMockLocationSuspected || Boolean(data.isMockLocationSuspected);
  visit.status = "completed";
  visit.updatedBy = executiveId;

  if (visitType.allowsOrderCreation === true && data.order) {
    const orderPayload = {
      ...data.order,
      sourceVisitId: visit._id,
      assignedTo: data.order.assignedTo || executiveId,
    };
    const orderResult = await createOrder(companyId, orderPayload, user || { _id: executiveId, companyId });
    visit.orderCreatedId = orderResult.order._id;
  }

  await visit.save();

  const followUp = await createVisitFollowUp(visit);

  await createLocationPoint(
    visit,
    {
      latitude: data.checkOutLatitude,
      longitude: data.checkOutLongitude,
      accuracy: data.checkOutAccuracy,
      isMockLocationSuspected: data.isMockLocationSuspected,
    },
    "check_out"
  );

  return {
    visit,
    duration: {
      seconds: visit.durationSeconds,
      minutes: Math.round((visit.durationSeconds / 60) * 100) / 100,
      status: visit.durationStatus,
    },
    summary: {
      leadCreatedId: visit.leadCreatedId || null,
      followUpId: followUp?._id || null,
      orderCreatedId: visit.orderCreatedId || null,
    },
  };
};

const cancelVisit = async (visitId, executiveId, companyId, reason = "") => {
  assertCompanyId(companyId);

  const visit = await Visit.findOne({ _id: visitId, executiveId, companyId });
  if (!visit) throw new ApiError(404, "Visit not found");
  if (visit.status !== ACTIVE_STATUS) throw new ApiError(400, "Only started visits can be cancelled");

  const ageMinutes = (Date.now() - new Date(visit.startedAt).getTime()) / 60000;
  if (ageMinutes > 5) {
    throw new ApiError(400, "Visit can be cancelled only within 5 minutes of start");
  }

  visit.status = "cancelled";
  visit.endedAt = new Date();
  visit.notes = `Cancelled: ${reason || "No reason provided"}`;
  visit.updatedBy = executiveId;
  await visit.save();
  return visit;
};

const addVisitLocationPoint = async (visitId, executiveId, companyId, data) => {
  assertCompanyId(companyId);

  if (data.latitude === undefined || data.longitude === undefined) {
    throw new ApiError(400, "Latitude and longitude are required");
  }

  const visit = await Visit.findOne({ _id: visitId, executiveId, companyId, status: ACTIVE_STATUS });
  if (!visit) throw new ApiError(404, "Active visit not found");

  return createLocationPoint(
    visit,
    {
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.accuracy,
      speed: data.speed,
      heading: data.heading,
      batteryLevel: data.batteryLevel,
      recordedAt: data.recordedAt,
      isMockLocationSuspected: data.isMockLocationSuspected,
    },
    data.source || "background"
  );
};

const paginate = (query, { page = 1, limit = 20 } = {}) => {
  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return query.skip((parsedPage - 1) * parsedLimit).limit(parsedLimit);
};

const listVisits = async (companyId, filter = {}, options = {}, user = null) => {
  assertCompanyId(companyId);
  const requestedExecutiveId = filter.executiveId || options.executiveId || null;
  const domainFilter = { ...filter };
  delete domainFilter.executiveId;
  delete domainFilter.reportingManagerId;
  const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
  const query = Visit.find(andFilters(
    { companyId, ...domainFilter },
    visibility ? buildVisitVisibilityFilter(visibility, requestedExecutiveId) : (requestedExecutiveId ? { executiveId: requestedExecutiveId } : {})
  ))
    .populate("visitTypeId", "name code")
    .populate("executiveId", "fullName email role")
    .populate("reportingManagerId", "fullName email role")
    .sort({ startedAt: -1 });
  return paginate(query, options).lean();
};

const getVisitDetail = async (visitId, companyId, user = null) => {
  assertCompanyId(companyId);
  const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
  const visit = await Visit.findOne(andFilters(
    { _id: visitId, companyId },
    visibility ? buildVisitVisibilityFilter(visibility) : {}
  ))
    .populate("visitTypeId")
    .populate("executiveId", "fullName email role")
    .populate("reportingManagerId", "fullName email role")
    .populate("visitPurposeId", "name code")
    .populate("visitOutcomeId", "name code")
    .lean();
  if (!visit) throw new ApiError(404, "Visit not found");
  return visit;
};

const getVisitRoute = async (visitId, companyId, user = null) => {
  await getVisitDetail(visitId, companyId, user);
  return VisitLocationPoint.find({ visitId, companyId }).sort({ recordedAt: 1 }).lean();
};

const approveVisit = async (visitId, approverId, companyId, user = null) => {
  assertCompanyId(companyId);
  const visibility = user ? await resolveSalesVisibilityContext({ user, companyId }) : null;
  const visit = await Visit.findOne(andFilters(
    { _id: visitId, companyId },
    visibility ? buildVisitVisibilityFilter(visibility) : {}
  ));
  if (!visit) throw new ApiError(404, "Visit not found");

  visit.managerApprovalRequired = false;
  visit.managerApprovedBy = approverId;
  visit.managerApprovedAt = new Date();
  visit.updatedBy = approverId;
  await visit.save();
  return visit;
};

const autoCloseStaleVisits = async () => {
  const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000);
  const visits = await Visit.find({ status: ACTIVE_STATUS, startedAt: { $lt: cutoff } });

  for (const visit of visits) {
    visit.status = "auto_closed";
    visit.endedAt = new Date();
    visit.durationStatus = "exceeded";
    visit.notes = [visit.notes, "Auto-closed by system: visit not ended by executive"].filter(Boolean).join("\n");
    await visit.save();
  }

  return visits.length;
};

module.exports = {
  Visit,
  VisitLocationPoint,
  VIEW_ROLES,
  START_ROLES,
  APPROVER_ROLES,
  startVisit,
  endVisit,
  getActiveVisit,
  cancelVisit,
  addVisitLocationPoint,
  listVisits,
  getVisitDetail,
  getVisitRoute,
  approveVisit,
  autoCloseStaleVisits,
};
