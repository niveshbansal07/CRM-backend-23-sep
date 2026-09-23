const CompanySalesPerformancePolicy = require("../models/CompanySalesPerformancePolicy");
const SalesAchievementEvent = require("../models/SalesAchievementEvent");
const SalesTargetPlan = require("../models/SalesTargetPlan");
const ApiError = require("../utils/ApiError");
const { assertTimezone } = require("../utils/salesPerformance");
const { getAccessRole } = require("../utils/roleAccess");
const { writeAuditLog } = require("./auditLog.service");

const POLICY_READ_ROLES = ["super_admin", "company_admin", "sales_head", "sales_manager", "sales_executive"];
const POLICY_WRITE_ROLES = ["super_admin", "company_admin"];
const assertPolicyRole = (user, write = false) => {
  const role = getAccessRole(user);
  if (!(write ? POLICY_WRITE_ROLES : POLICY_READ_ROLES).includes(role)) throw new ApiError(403, "Sales performance policy access denied");
  return role;
};

const getPolicy = async (companyId, user) => {
  assertPolicyRole(user, false);
  return CompanySalesPerformancePolicy.findOne({ companyId }).lean();
};

const savePolicy = async ({ companyId, user, payload = {}, req = null }) => {
  assertPolicyRole(user, true);
  const existing = await CompanySalesPerformancePolicy.findOne({ companyId });
  const timezone = assertTimezone(String(payload.timezone || existing?.timezone || "Asia/Kolkata").trim());
  const fiscalStartMonth = Number(payload.fiscalStartMonth || existing?.fiscalStartMonth || 4);
  if (!Number.isInteger(fiscalStartMonth) || fiscalStartMonth < 1 || fiscalStartMonth > 12) throw new ApiError(400, "Fiscal start month must be 1-12");
  const status = String(payload.status || existing?.status || "DRAFT").toUpperCase();
  if (!['DRAFT', 'ACTIVE'].includes(status)) throw new ApiError(400, "Policy status must be DRAFT or ACTIVE");
  const activationDate = status === "ACTIVE" ? new Date(payload.activationDate || existing?.activationDate || Date.now()) : null;
  if (activationDate && Number.isNaN(activationDate.getTime())) throw new ApiError(400, "Valid activation date is required");

  if (existing?.status === "ACTIVE" && activationDate && activationDate > existing.activationDate) {
    const hasEvents = await SalesAchievementEvent.exists({ companyId });
    if (hasEvents) throw new ApiError(409, "Activation date cannot move later after achievement events exist");
  }
  if (existing) {
    const nextCurrency = String(payload.baseCurrency || existing.baseCurrency || "INR").trim().toUpperCase();
    const activationChanged = Number(activationDate || 0) !== Number(existing.activationDate || 0);
    const basisChanged = nextCurrency !== existing.baseCurrency || timezone !== existing.timezone || fiscalStartMonth !== existing.fiscalStartMonth || status !== existing.status || activationChanged;
    if (basisChanged) {
      const protectedPlan = await SalesTargetPlan.exists({ companyId, status: { $in: ["DRAFT", "SUBMITTED", "ACTIVE"] } });
      if (protectedPlan) throw new ApiError(409, "Currency, timezone, and fiscal basis cannot change while target plans exist; preserve the existing policy basis");
    }
  }
  const update = {
    baseCurrency: String(payload.baseCurrency || existing?.baseCurrency || "INR").trim().toUpperCase(),
    timezone, fiscalStartMonth, status, activationDate,
    updatedBy: user._id,
    activatedBy: status === "ACTIVE" ? user._id : null,
  };
  if (existing) update.policyVersion = Number(existing.policyVersion || 1) + 1;
  const policy = await CompanySalesPerformancePolicy.findOneAndUpdate(
    { companyId }, { $set: update, $setOnInsert: { companyId, createdBy: user._id, policyVersion: 1 } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await writeAuditLog({ companyId, actorId: user._id, action: status === "ACTIVE" ? "SALES_PERFORMANCE_POLICY_ACTIVATED" : "SALES_PERFORMANCE_POLICY_SAVED", entityType: "CompanySalesPerformancePolicy", entityId: policy._id, metadata: { policyVersion: policy.policyVersion, status }, req });
  return policy.toObject();
};

module.exports = { POLICY_READ_ROLES, POLICY_WRITE_ROLES, assertPolicyRole, getPolicy, savePolicy };
