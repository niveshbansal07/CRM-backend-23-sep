const WeeklyOffPolicy = require("../models/WeeklyOffPolicy");
const { assertCompanyScopedUser, getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");

const listWeeklyOffPolicies = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);
  return WeeklyOffPolicy.find({ companyId, deletedAt: null }).sort({ isDefault: -1, createdAt: -1 });
};

const upsertWeeklyOffPolicy = async ({ user, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);

  if (payload.isDefault !== false) {
    await WeeklyOffPolicy.updateMany(
      { companyId, isDefault: true, deletedAt: null },
      { $set: { isDefault: false, updatedBy: user._id } }
    );
  }

  const policy = await WeeklyOffPolicy.create({
    companyId,
    name: payload.name,
    weeklyOffDays: payload.weeklyOffDays,
    secondAndFourthSaturdayOff: payload.secondAndFourthSaturdayOff,
    isDefault: payload.isDefault !== false,
    isActive: payload.isActive !== false,
    createdBy: user._id,
    updatedBy: user._id,
  });

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "weekly_off_policy_created",
    entityType: "WeeklyOffPolicy",
    entityId: policy._id,
    req,
  });

  return policy;
};

const updateWeeklyOffPolicy = async ({ user, policyId, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const policy = await WeeklyOffPolicy.findOne({ _id: policyId, companyId, deletedAt: null });

  if (!policy) {
    const ApiError = require("../utils/ApiError");
    throw new ApiError(404, "Weekly off policy not found");
  }

  if (payload.isDefault === true) {
    await WeeklyOffPolicy.updateMany(
      { companyId, _id: { $ne: policy._id }, isDefault: true, deletedAt: null },
      { $set: { isDefault: false, updatedBy: user._id } }
    );
  }

  Object.assign(policy, payload, { updatedBy: user._id });
  await policy.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "weekly_off_policy_updated",
    entityType: "WeeklyOffPolicy",
    entityId: policy._id,
    req,
  });

  return policy;
};

module.exports = {
  listWeeklyOffPolicies,
  upsertWeeklyOffPolicy,
  updateWeeklyOffPolicy,
};
