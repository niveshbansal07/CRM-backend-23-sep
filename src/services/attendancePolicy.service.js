const AttendancePolicy = require("../models/AttendancePolicy");
const ApiError = require("../utils/ApiError");
const { assertCompanyScopedUser, getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");

const DEFAULT_POLICY = {
  name: "Default Attendance Policy",
  workingDays: [1, 2, 3, 4, 5],
  weeklyOffs: [0, 6],
  fullDayMinutes: 480,
  halfDayMinutes: 240,
  graceMinutes: 10,
  breakMinutes: 60,
  lateAllowedPerMonth: 2,
  lateAfterTime: "12:00",
  thirdLatePenalty: "HALF_DAY",
  consecutiveLateLimit: 3,
  afterConsecutiveLatePenalty: "ABSENT",
  overtimeEnabled: false,
  overtimeAfterMinutes: 540,
  correctionAllowed: true,
  isDefault: true,
  status: "active",
};

const normalizePolicyPayload = (payload) => {
  const clean = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value !== undefined) clean[key] = value;
  });
  return clean;
};

const getDefaultPolicyForCompany = async (companyId, session = null) => {
  const query = AttendancePolicy.findOne({
    companyId,
    isDefault: true,
    status: "active",
    deletedAt: null,
  }).sort({ updatedAt: -1 });

  if (session) query.session(session);

  const policy = await query;
  return policy || DEFAULT_POLICY;
};

const listPolicies = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);

  return AttendancePolicy.find({ companyId, deletedAt: null }).sort({ isDefault: -1, createdAt: -1 });
};

const createPolicy = async ({ user, payload, req }) => {
  const companyId = assertCompanyScopedUser(user);
  const data = normalizePolicyPayload(payload);

  if (data.isDefault !== false) {
    await AttendancePolicy.updateMany(
      { companyId, isDefault: true, deletedAt: null },
      { $set: { isDefault: false, updatedBy: user._id } }
    );
  }

  const policy = await AttendancePolicy.create({
    ...data,
    companyId,
    createdBy: user._id,
    updatedBy: user._id,
  });

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "attendance_policy_created",
    entityType: "AttendancePolicy",
    entityId: policy._id,
    req,
  });

  return policy;
};

const updatePolicy = async ({ user, policyId, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const policy = await AttendancePolicy.findOne({ _id: policyId, companyId, deletedAt: null });

  if (!policy) {
    throw new ApiError(404, "Attendance policy not found");
  }

  const data = normalizePolicyPayload(payload);

  if (data.isDefault === true) {
    await AttendancePolicy.updateMany(
      { companyId, _id: { $ne: policy._id }, isDefault: true, deletedAt: null },
      { $set: { isDefault: false, updatedBy: user._id } }
    );
  }

  Object.assign(policy, data, { updatedBy: user._id });
  await policy.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "attendance_policy_updated",
    entityType: "AttendancePolicy",
    entityId: policy._id,
    req,
  });

  return policy;
};

module.exports = {
  DEFAULT_POLICY,
  getDefaultPolicyForCompany,
  listPolicies,
  createPolicy,
  updatePolicy,
};
