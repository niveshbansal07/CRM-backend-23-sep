const User = require("../models/User");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { getAccessRole } = require("../utils/roleAccess");
const {
  getCompatibleReportingManagers,
  buildSalesTransferPreview,
  applySalesTransfer,
  buildEndAssignmentPreview,
  applyEndAssignment,
  buildOffboardingPreview,
  processSalesEmployeeOffboarding,
  getSalesLifecycleHistory,
} = require("../services/salesEmployeeLifecycle.service");

const previewTransferController = async (req, res, next) => {
  try {
    const preview = await buildSalesTransferPreview({ payload: req.validatedBody, user: req.user });
    return res.status(200).json(new ApiResponse(200, "Sales transfer impact preview generated", { preview }));
  } catch (error) { next(error); }
};

const applyTransferController = async (req, res, next) => {
  try {
    const result = await applySalesTransfer({ payload: req.validatedBody, user: req.user, req });
    return res.status(200).json(new ApiResponse(200, result.applied ? "Sales transfer applied" : "Sales transfer already matches current state", result));
  } catch (error) { next(error); }
};

const getManagerCandidatesController = async (req, res, next) => {
  try {
    const selection = await getCompatibleReportingManagers({
      employeeId: req.params.employeeId,
      geographyId: req.validatedQuery.geographyId,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Compatible Sales reporting managers fetched", { selection }));
  } catch (error) { next(error); }
};

const previewEndController = async (req, res, next) => {
  try {
    const preview = await buildEndAssignmentPreview({
      employeeId: req.params.employeeId,
      reason: req.validatedBody.reason,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Assignment ending impact preview generated", { preview }));
  } catch (error) { next(error); }
};

const applyEndController = async (req, res, next) => {
  try {
    const result = await applyEndAssignment({
      employeeId: req.params.employeeId,
      reason: req.validatedBody.reason,
      user: req.user,
      req,
    });
    return res.status(200).json(new ApiResponse(200, "Sales assignment ended and vacancy created", result));
  } catch (error) { next(error); }
};

const getHistoryController = async (req, res, next) => {
  try {
    const history = await getSalesLifecycleHistory({ employeeId: req.params.employeeId, user: req.user });
    return res.status(200).json(new ApiResponse(200, "Sales employee lifecycle history fetched", { history }));
  } catch (error) { next(error); }
};

const loadOffboardingActorAndEmployee = async (req) => {
  const query = { _id: req.params.employeeId, deletedAt: null };
  if (getAccessRole(req.user) !== "super_admin") query.companyId = req.user.companyId;
  const employee = await User.findOne(query).select("-passwordHash");
  if (!employee) throw new ApiError(404, "Employee not found");
  return { employee, actor: { ...(req.user.toObject?.() || req.user), companyId: employee.companyId } };
};

const previewOffboardingController = async (req, res, next) => {
  try {
    const { employee, actor } = await loadOffboardingActorAndEmployee(req);
    const preview = await buildOffboardingPreview({
      employeeId: employee._id,
      targetStatus: req.validatedBody.targetStatus,
      reason: req.validatedBody.reason,
      user: actor,
    });
    return res.status(200).json(new ApiResponse(200, "Sales offboarding impact preview generated", { preview }));
  } catch (error) { next(error); }
};

const applyOffboardingController = async (req, res, next) => {
  try {
    const { employee, actor } = await loadOffboardingActorAndEmployee(req);
    const result = await processSalesEmployeeOffboarding({
      employee,
      previousStatus: employee.status,
      targetStatus: req.validatedBody.targetStatus,
      reason: req.validatedBody.reason,
      user: actor,
      req,
      deletion: req.validatedBody.targetStatus === "deleted",
    });
    if (!result.handled) throw new ApiError(400, "Employee is not eligible for Sales offboarding orchestration");
    return res.status(200).json(new ApiResponse(200, "Sales employee offboarding processed", {
      user: employee.toSafeObject(),
      preview: result.preview,
      event: result.event,
    }));
  } catch (error) { next(error); }
};

module.exports = {
  previewTransferController,
  applyTransferController,
  getManagerCandidatesController,
  previewEndController,
  applyEndController,
  getHistoryController,
  previewOffboardingController,
  applyOffboardingController,
};
