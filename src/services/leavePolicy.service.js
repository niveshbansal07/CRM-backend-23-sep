const LeavePolicy = require("../models/LeavePolicy");
const ApiError = require("../utils/ApiError");
const { assertCompanyScopedUser, getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");

const listLeavePolicies = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);
  return LeavePolicy.find({ companyId, deletedAt: null }).sort({ isDefault: -1, createdAt: -1 });
};

const createLeavePolicy = async ({ user, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);

  if (payload.isDefault !== false) {
    await LeavePolicy.updateMany(
      { companyId, isDefault: true, deletedAt: null },
      { $set: { isDefault: false, updatedBy: user._id } }
    );
  }

  const policy = await LeavePolicy.create({
    companyId,
    name: payload.name,
    sandwichRuleEnabled: Boolean(payload.sandwichRuleEnabled),
    allowBackdatedLeave: Boolean(payload.allowBackdatedLeave),
    maxBackdatedDays: Number(payload.maxBackdatedDays || 0),
    isDefault: payload.isDefault !== false,
    isActive: payload.isActive !== false,
    createdBy: user._id,
    updatedBy: user._id,
  });

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "leave_policy_created",
    entityType: "LeavePolicy",
    entityId: policy._id,
    req,
  });

  return policy;
};

const updateLeavePolicy = async ({ user, policyId, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const policy = await LeavePolicy.findOne({ _id: policyId, companyId, deletedAt: null });
  if (!policy) throw new ApiError(404, "Leave policy not found");

  if (payload.isDefault === true) {
    await LeavePolicy.updateMany(
      { companyId, _id: { $ne: policy._id }, isDefault: true, deletedAt: null },
      { $set: { isDefault: false, updatedBy: user._id } }
    );
  }

  Object.assign(policy, payload, { updatedBy: user._id });
  await policy.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "leave_policy_updated",
    entityType: "LeavePolicy",
    entityId: policy._id,
    req,
  });

  return policy;
};

module.exports = {
  listLeavePolicies,
  createLeavePolicy,
  updateLeavePolicy,
};
