const ApiResponse = require("../utils/ApiResponse");
const {
  listLeavePolicies,
  createLeavePolicy,
  updateLeavePolicy,
} = require("../services/leavePolicy.service");

const normalizePayload = (body = {}) => ({
  name: String(body.name || "Default Leave Policy").trim(),
  sandwichRuleEnabled: Boolean(body.sandwichRuleEnabled),
  allowBackdatedLeave: Boolean(body.allowBackdatedLeave),
  maxBackdatedDays: Number(body.maxBackdatedDays || 0),
  isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : true,
  isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
});

const listLeavePoliciesController = async (req, res, next) => {
  try {
    const policies = await listLeavePolicies({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Leave policies fetched successfully", { policies }));
  } catch (error) {
    next(error);
  }
};

const createLeavePolicyController = async (req, res, next) => {
  try {
    const policy = await createLeavePolicy({ user: req.user, payload: normalizePayload(req.body), req });
    res.status(201).json(new ApiResponse(201, "Leave policy created successfully", { policy }));
  } catch (error) {
    next(error);
  }
};

const updateLeavePolicyController = async (req, res, next) => {
  try {
    const policy = await updateLeavePolicy({
      user: req.user,
      policyId: req.params.id,
      payload: normalizePayload(req.body),
      req,
    });
    res.status(200).json(new ApiResponse(200, "Leave policy updated successfully", { policy }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listLeavePoliciesController,
  createLeavePolicyController,
  updateLeavePolicyController,
};
