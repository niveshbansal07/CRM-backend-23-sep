const FollowUp = require("../models/FollowUp");
const Lead = require("../models/Lead");
const CrmMaster = require("../models/CrmMaster");
const ApiError = require("../utils/ApiError");
const { createNotification } = require("./notification.service");
const { logActivity } = require("./activityLog.service");
const {
  andFilters,
  resolveSalesVisibilityContext,
  buildLeadVisibilityFilter,
  buildFollowUpVisibilityFilter,
  assertEmployeeWithinVisibility,
  assertAccountWithinVisibility,
} = require("./salesVisibility.service");

const SALES_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];
const MANAGER_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager"];

const formatDate = (value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

const buildFilter = (companyId, filters = {}) => {
  const query = { companyId, deletedAt: null };
  if (filters.status) query.status = filters.status;
  if (filters.followUpType) query.followUpType = filters.followUpType;
  if (filters.isOverdue !== undefined) query.isOverdue = filters.isOverdue === true || filters.isOverdue === "true";
  if (filters.leadId) query.leadId = filters.leadId;
  if (filters.assignedTo) query.assignedTo = filters.assignedTo;
  if (filters.dateFrom || filters.dateTo) {
    query.scheduledAt = {};
    if (filters.dateFrom) query.scheduledAt.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) query.scheduledAt.$lte = new Date(filters.dateTo);
  }
  return query;
};

const populateFollowUp = (query) =>
  query
    .populate("leadId", "name companyName phone email status convertedAt")
    .populate("accountId", "name phone email city")
    .populate("assignedTo", "fullName email role reportingManagerId")
    .populate("createdBy", "fullName email role")
    .populate("completionOutcomeId", "name code");

const paginate = async (query, { page = 1, limit = 30 } = {}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const [items, total] = await Promise.all([
    populateFollowUp(query.clone())
      .sort({ isOverdue: -1, status: 1, scheduledAt: 1, completedAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    query.model.countDocuments(query.getFilter()),
  ]);
  return { items, pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) } };
};

const getLeadForFollowUp = async (leadId, companyId) => {
  const lead = await Lead.findOne({ _id: leadId, companyId, deletedAt: null });
  if (!lead) throw new ApiError(404, "Lead not found");
  return lead;
};

const createFollowUp = async (data = {}, createdBy, companyId, user = null) => {
  let lead;
  let visibility = null;
  if (user) {
    visibility = await resolveSalesVisibilityContext({ user, companyId });
    lead = await Lead.findOne(andFilters(
      { _id: data.leadId, companyId, deletedAt: null },
      buildLeadVisibilityFilter(visibility)
    ));
    if (!lead) throw new ApiError(404, "Lead not found");
  } else {
    lead = await getLeadForFollowUp(data.leadId, companyId);
  }
  const assignedTo = data.assignedTo || lead.assignedTo || createdBy;
  if (visibility && String(assignedTo) !== String(user?._id)) {
    await assertEmployeeWithinVisibility({ context: visibility, employeeId: assignedTo, companyId });
  }
  if (visibility && data.accountId) {
    await assertAccountWithinVisibility({ context: visibility, accountId: data.accountId, companyId });
  }

  const followUp = await FollowUp.create({
    companyId,
    leadId: lead._id,
    accountId: data.accountId || lead.linkedAccountId || null,
    assignedTo,
    followUpType: data.followUpType || "call",
    scheduledAt: data.scheduledAt,
    title: data.title || `Follow-up with ${lead.name}`,
    notes: data.notes || data.note || "",
    note: data.notes || data.note || "",
    priority: data.priority || "normal",
    source: data.source || "manual",
    parentFollowUpId: data.parentFollowUpId || null,
    relatedVisitId: data.relatedVisitId || data.visitId || null,
    visitId: data.visitId || data.relatedVisitId || null,
    relatedOrderId: data.relatedOrderId || null,
    createdBy,
    updatedBy: createdBy,
  });

  await logActivity({
    companyId,
    entityType: "lead",
    entityId: lead._id,
    activityType: "followup_created",
    performedBy: createdBy,
    title: `Follow-up scheduled: ${followUp.followUpType} on ${formatDate(followUp.scheduledAt)}`,
    description: followUp.title,
    metadata: { followUpId: followUp._id, followUpType: followUp.followUpType },
  });

  await createNotification({
    companyId,
    receiverId: assignedTo,
    senderId: createdBy,
    type: "followup_scheduled",
    title: "New follow-up scheduled",
    message: `New follow-up scheduled: ${followUp.title} on ${formatDate(followUp.scheduledAt)}`,
    referenceType: "followup",
    referenceId: followUp._id,
    data: { followUpId: followUp._id, leadId: lead._id },
  }).catch(() => null);

  return followUp;
};

const getFollowUpForAction = async (followUpId, userId, companyId, user = null) => {
  const visibilityFilter = user
    ? buildFollowUpVisibilityFilter(await resolveSalesVisibilityContext({ user, companyId }))
    : { assignedTo: userId };
  const followUp = await FollowUp.findOne(andFilters(
    { _id: followUpId, companyId, deletedAt: null },
    visibilityFilter
  ));
  if (!followUp) throw new ApiError(404, "Follow-up not found");
  if (followUp.status !== "pending") throw new ApiError(400, "Follow-up already completed/rescheduled");
  return followUp;
};

const completeFollowUp = async (followUpId, userId, companyId, data = {}, user = null) => {
  const followUp = await getFollowUpForAction(followUpId, userId, companyId, user);
  if (!String(data.completionNotes || "").trim()) throw new ApiError(400, "Completion notes are required");

  followUp.status = "completed";
  followUp.completedAt = new Date();
  followUp.completedBy = userId;
  followUp.completionNotes = data.completionNotes;
  followUp.completionOutcomeId = data.completionOutcomeId || null;
  followUp.isOverdue = false;
  followUp.updatedBy = userId;
  await followUp.save();

  let outcomeLabel = "completed";
  if (data.completionOutcomeId) {
    const outcome = await CrmMaster.findOne({ _id: data.completionOutcomeId, companyId }).select("name").lean();
    outcomeLabel = outcome?.name || outcomeLabel;
  }

  await logActivity({
    companyId,
    entityType: "lead",
    entityId: followUp.leadId,
    activityType: "followup_completed",
    performedBy: userId,
    title: `Follow-up completed: ${followUp.followUpType} - ${outcomeLabel}`,
    description: data.completionNotes,
    metadata: { followUpId, completionNotes: data.completionNotes, outcomeId: data.completionOutcomeId || null },
  });

  let nextFollowUp = null;
  if (data.nextFollowUp?.scheduledAt) {
    nextFollowUp = await createFollowUp({
      leadId: followUp.leadId,
      accountId: followUp.accountId,
      followUpType: data.nextFollowUp.followUpType || "call",
      scheduledAt: data.nextFollowUp.scheduledAt,
      title: data.nextFollowUp.title || "Next follow-up",
      notes: data.nextFollowUp.notes || "",
      priority: data.nextFollowUp.priority || "normal",
      source: "manual",
      parentFollowUpId: followUp._id,
    }, userId, companyId);
  }

  return { followUp, nextFollowUp };
};

const rescheduleFollowUp = async (followUpId, userId, companyId, data = {}, user = null) => {
  const followUp = await getFollowUpForAction(followUpId, userId, companyId, user);
  if (!data.newScheduledAt) throw new ApiError(400, "New scheduled time is required");
  const oldDate = followUp.scheduledAt;
  followUp.rescheduledFrom = oldDate;
  followUp.scheduledAt = data.newScheduledAt;
  followUp.rescheduleReason = data.rescheduleReason || "";
  followUp.status = "pending";
  followUp.reminderSentAt = null;
  followUp.isOverdue = false;
  followUp.updatedBy = userId;
  await followUp.save();

  await logActivity({
    companyId,
    entityType: "lead",
    entityId: followUp.leadId,
    activityType: "followup_rescheduled",
    performedBy: userId,
    title: `Follow-up rescheduled from ${formatDate(oldDate)} to ${formatDate(followUp.scheduledAt)}`,
    description: followUp.rescheduleReason,
    metadata: { followUpId, oldScheduledAt: oldDate, newScheduledAt: followUp.scheduledAt },
  });

  return followUp;
};

const skipFollowUp = async (followUpId, userId, companyId, reason = "", user = null) => {
  const followUp = await getFollowUpForAction(followUpId, userId, companyId, user);
  followUp.status = "skipped";
  followUp.completionNotes = `Skipped: ${reason || "No reason provided"}`;
  followUp.completedAt = new Date();
  followUp.completedBy = userId;
  followUp.updatedBy = userId;
  await followUp.save();

  await logActivity({
    companyId,
    entityType: "lead",
    entityId: followUp.leadId,
    activityType: "followup_skipped",
    performedBy: userId,
    title: `Follow-up skipped: ${followUp.title}`,
    description: reason,
    metadata: { followUpId },
  });

  return followUp;
};

const getFollowUpsForLead = async (leadId, companyId, filters = {}, user = null) => {
  await getLeadForFollowUp(leadId, companyId);
  const visibilityFilter = user
    ? buildFollowUpVisibilityFilter(await resolveSalesVisibilityContext({ user, companyId }))
    : {};
  const query = FollowUp.find(andFilters(
    buildFilter(companyId, { ...filters, leadId }),
    visibilityFilter
  ));
  return populateFollowUp(query).sort({ status: 1, scheduledAt: 1, completedAt: -1 }).lean();
};

const getMyFollowUps = async (userId, companyId, filters = {}) => {
  const query = FollowUp.find(buildFilter(companyId, { ...filters, assignedTo: userId }));
  return paginate(query, filters);
};

const getTeamFollowUps = async (managerId, companyId, filters = {}, user = {}) => {
  void managerId;
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const query = FollowUp.find(andFilters(
    buildFilter(companyId, filters),
    buildFollowUpVisibilityFilter(visibility, filters.executiveId)
  ));
  return paginate(query, filters);
};

const getTodaysFollowUps = async (userId, companyId) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return populateFollowUp(FollowUp.find({
    companyId,
    assignedTo: userId,
    status: "pending",
    deletedAt: null,
    $or: [
      { scheduledAt: { $gte: start, $lt: end } },
      { scheduledAt: { $lt: start } },
    ],
  })).sort({ isOverdue: -1, scheduledAt: 1 }).lean();
};

const getFollowUpById = async (followUpId, companyId, user) => {
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const followUp = await populateFollowUp(FollowUp.findOne(andFilters(
    { _id: followUpId, companyId, deletedAt: null },
    buildFollowUpVisibilityFilter(visibility)
  ))).lean();
  if (!followUp) throw new ApiError(404, "Follow-up not found");
  return followUp;
};

const markOverdueFollowUps = async () => {
  const rows = await FollowUp.find({ status: "pending", scheduledAt: { $lt: new Date() }, isOverdue: false, deletedAt: null });
  for (const followUp of rows) {
    followUp.isOverdue = true;
    await followUp.save();
    await logActivity({
      companyId: followUp.companyId,
      entityType: "lead",
      entityId: followUp.leadId,
      activityType: "followup_overdue_escalated",
      performedBy: followUp.assignedTo,
      title: `Follow-up overdue: ${followUp.title}`,
      metadata: { followUpId: followUp._id },
      isSystemGenerated: true,
    }).catch(() => null);
    await createNotification({
      companyId: followUp.companyId,
      receiverId: followUp.assignedTo,
      type: "followup_overdue",
      title: "Follow-up overdue",
      message: `Your follow-up is overdue: "${followUp.title}"`,
      referenceType: "followup",
      referenceId: followUp._id,
      data: { followUpId: followUp._id, leadId: followUp.leadId },
    }).catch(() => null);
  }
  return rows.length;
};

const sendFollowUpReminders = async () => {
  const from = new Date(Date.now() + 55 * 60 * 1000);
  const to = new Date(Date.now() + 65 * 60 * 1000);
  const rows = await FollowUp.find({ status: "pending", scheduledAt: { $gte: from, $lte: to }, reminderSentAt: null, deletedAt: null });
  for (const followUp of rows) {
    followUp.reminderSentAt = new Date();
    await followUp.save();
    await createNotification({
      companyId: followUp.companyId,
      receiverId: followUp.assignedTo,
      type: "followup_reminder",
      title: "Follow-up reminder",
      message: `Reminder: "${followUp.title}" is due in 1 hour`,
      referenceType: "followup",
      referenceId: followUp._id,
      data: { followUpId: followUp._id, leadId: followUp.leadId },
    }).catch(() => null);
  }
  return rows.length;
};

const escalateStaleFollowUps = async () => {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await FollowUp.find({ status: "pending", isOverdue: true, scheduledAt: { $lt: cutoff }, escalatedAt: null, deletedAt: null })
    .populate("assignedTo", "fullName reportingManagerId")
    .populate("leadId", "name");
  for (const followUp of rows) {
    const managerId = followUp.assignedTo?.reportingManagerId;
    if (!managerId) continue;
    followUp.escalatedAt = new Date();
    followUp.escalatedTo = managerId;
    await followUp.save();
    await createNotification({
      companyId: followUp.companyId,
      receiverId: managerId,
      type: "followup_escalation",
      title: "Follow-up escalation",
      message: `${followUp.assignedTo?.fullName || "Executive"}'s follow-up is overdue by 1+ day: "${followUp.title}" - Lead: ${followUp.leadId?.name || "-"}`,
      referenceType: "followup",
      referenceId: followUp._id,
      data: { followUpId: followUp._id, leadId: followUp.leadId?._id || followUp.leadId, executiveId: followUp.assignedTo?._id },
    }).catch(() => null);
    await logActivity({
      companyId: followUp.companyId,
      entityType: "lead",
      entityId: followUp.leadId?._id || followUp.leadId,
      activityType: "followup_overdue_escalated",
      performedBy: followUp.assignedTo?._id || followUp.assignedTo,
      title: `Follow-up escalated: ${followUp.title}`,
      metadata: { followUpId: followUp._id, managerId },
      isSystemGenerated: true,
    }).catch(() => null);
  }
  return rows.length;
};

module.exports = {
  FollowUp,
  SALES_ROLES,
  MANAGER_ROLES,
  createFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  skipFollowUp,
  getFollowUpsForLead,
  getMyFollowUps,
  getTeamFollowUps,
  getTodaysFollowUps,
  getFollowUpById,
  markOverdueFollowUps,
  sendFollowUpReminders,
  escalateStaleFollowUps,
};
