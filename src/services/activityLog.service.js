const ActivityLog = require("../models/ActivityLog");
const Lead = require("../models/Lead");
const Account = require("../models/Account");
const ApiError = require("../utils/ApiError");

const logActivity = async (data = {}) => {
  return ActivityLog.create({
    companyId: data.companyId,
    entityType: data.entityType,
    entityId: data.entityId,
    activityType: data.activityType,
    performedBy: data.performedBy,
    performedAt: data.performedAt || new Date(),
    title: data.title,
    description: data.description || "",
    metadata: data.metadata || {},
    isSystemGenerated: Boolean(data.isSystemGenerated),
  });
};

const buildTimelineFilter = (companyId, entityType, entityId, filters = {}) => {
  const query = { companyId, entityType, entityId };
  if (filters.activityType) query.activityType = filters.activityType;
  if (filters.dateFrom || filters.dateTo) {
    query.performedAt = {};
    if (filters.dateFrom) query.performedAt.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) query.performedAt.$lte = new Date(filters.dateTo);
  }
  return query;
};

const getTimeline = async (companyId, entityType, entityId, filters = {}) => {
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 30));
  const query = buildTimelineFilter(companyId, entityType, entityId, filters);

  const [items, total] = await Promise.all([
    ActivityLog.find(query)
      .populate("performedBy", "fullName email role")
      .sort({ performedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ActivityLog.countDocuments(query),
  ]);

  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const getLeadTimeline = async (leadId, companyId, filters = {}) => {
  const lead = await Lead.findOne({ _id: leadId, companyId, deletedAt: null }).select("_id").lean();
  if (!lead) throw new ApiError(404, "Lead not found");
  return getTimeline(companyId, "lead", leadId, filters);
};

const getAccountTimeline = async (accountId, companyId, filters = {}) => {
  const account = await Account.findOne({ _id: accountId, companyId, deletedAt: null }).select("_id").lean();
  if (!account) throw new ApiError(404, "Account not found");
  return getTimeline(companyId, "account", accountId, filters);
};

module.exports = {
  ActivityLog,
  logActivity,
  getLeadTimeline,
  getAccountTimeline,
};
