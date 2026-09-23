const ApiResponse = require("../utils/ApiResponse");
const {
  listPolicies,
  createPolicy,
  updatePolicy,
} = require("../services/attendancePolicy.service");

const listPoliciesController = async (req, res, next) => {
  try {
    const policies = await listPolicies({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Attendance policies fetched successfully", { policies }));
  } catch (error) {
    next(error);
  }
};

const createPolicyController = async (req, res, next) => {
  try {
    const policy = await createPolicy({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Attendance policy created successfully", { policy }));
  } catch (error) {
    next(error);
  }
};

const updatePolicyController = async (req, res, next) => {
  try {
    const policy = await updatePolicy({
      user: req.user,
      policyId: req.params.id,
      payload: req.validatedBody,
      req,
    });
    res.status(200).json(new ApiResponse(200, "Attendance policy updated successfully", { policy }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listPoliciesController,
  createPolicyController,
  updatePolicyController,
};
