const ApiResponse = require("../utils/ApiResponse");
const {
  listWeeklyOffPolicies,
  upsertWeeklyOffPolicy,
  updateWeeklyOffPolicy,
} = require("../services/weeklyOffPolicy.service");

const normalizePayload = (body = {}) => ({
  name: String(body.name || "Default Weekly Off Policy").trim(),
  weeklyOffDays: Array.isArray(body.weeklyOffDays) ? body.weeklyOffDays.map(Number) : [0, 6],
  secondAndFourthSaturdayOff: Boolean(body.secondAndFourthSaturdayOff),
  isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : true,
  isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
});

const listWeeklyOffPoliciesController = async (req, res, next) => {
  try {
    const policies = await listWeeklyOffPolicies({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Weekly off policies fetched successfully", { policies }));
  } catch (error) {
    next(error);
  }
};

const createWeeklyOffPolicyController = async (req, res, next) => {
  try {
    const policy = await upsertWeeklyOffPolicy({ user: req.user, payload: normalizePayload(req.body), req });
    res.status(201).json(new ApiResponse(201, "Weekly off policy created successfully", { policy }));
  } catch (error) {
    next(error);
  }
};

const updateWeeklyOffPolicyController = async (req, res, next) => {
  try {
    const policy = await updateWeeklyOffPolicy({
      user: req.user,
      policyId: req.params.id,
      payload: normalizePayload(req.body),
      req,
    });
    res.status(200).json(new ApiResponse(200, "Weekly off policy updated successfully", { policy }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listWeeklyOffPoliciesController,
  createWeeklyOffPolicyController,
  updateWeeklyOffPolicyController,
};
