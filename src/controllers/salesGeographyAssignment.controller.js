const ApiResponse = require("../utils/ApiResponse");
const {
  previewSalesGeographyAssignment,
  assignSalesGeography,
  endCurrentSalesGeographyAssignment,
  getCurrentAssignmentForEmployee,
  getAssignmentHistoryForEmployee,
  getCurrentAssignmentsForGeography,
  listCompatibleGeographiesForEmployee,
  listSalesAssignmentReadiness,
  buildSalesAssignmentTree,
} = require("../services/salesGeographyAssignment.service");

const getReadinessController = async (req, res, next) => {
  try {
    const employees = await listSalesAssignmentReadiness({ user: req.user });
    return res.status(200).json(new ApiResponse(200, "Sales assignment readiness fetched", { employees }));
  } catch (error) { next(error); }
};

const getAssignmentTreeController = async (req, res, next) => {
  try {
    const tree = await buildSalesAssignmentTree({ user: req.user });
    return res.status(200).json(new ApiResponse(200, "Sales assignment tree fetched", { tree }));
  } catch (error) { next(error); }
};

const getCompatibleGeographiesController = async (req, res, next) => {
  try {
    const selection = await listCompatibleGeographiesForEmployee({
      employeeId: req.params.employeeId,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Compatible Sales Geography fetched", { selection }));
  } catch (error) { next(error); }
};

const previewAssignmentController = async (req, res, next) => {
  try {
    const preview = await previewSalesGeographyAssignment({
      payload: req.validatedBody,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Sales Geography assignment preview generated", { preview }));
  } catch (error) { next(error); }
};

const assignController = async (req, res, next) => {
  try {
    const assignment = await assignSalesGeography({
      payload: req.validatedBody,
      user: req.user,
      req,
    });
    return res.status(201).json(new ApiResponse(201, "Sales Geography assignment applied", { assignment }));
  } catch (error) { next(error); }
};

const endAssignmentController = async (req, res, next) => {
  try {
    const assignment = await endCurrentSalesGeographyAssignment({
      employeeId: req.params.employeeId,
      reason: req.validatedBody.reason,
      user: req.user,
      req,
    });
    return res.status(200).json(new ApiResponse(200, "Current Sales Geography assignment ended", { assignment }));
  } catch (error) { next(error); }
};

const getCurrentController = async (req, res, next) => {
  try {
    const assignment = await getCurrentAssignmentForEmployee({
      employeeId: req.params.employeeId,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Current Sales Geography assignment fetched", { assignment }));
  } catch (error) { next(error); }
};

const getMineController = async (req, res, next) => {
  try {
    const assignment = await getCurrentAssignmentForEmployee({
      employeeId: req.user._id,
      user: req.user,
      ownOnly: true,
    });
    return res.status(200).json(new ApiResponse(200, "Your Sales Geography assignment fetched", { assignment }));
  } catch (error) { next(error); }
};

const getHistoryController = async (req, res, next) => {
  try {
    const history = await getAssignmentHistoryForEmployee({
      employeeId: req.params.employeeId,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Sales Geography assignment history fetched", { history }));
  } catch (error) { next(error); }
};

const getGeographyAssignmentsController = async (req, res, next) => {
  try {
    const assignments = await getCurrentAssignmentsForGeography({
      geographyId: req.params.geographyId,
      user: req.user,
    });
    return res.status(200).json(new ApiResponse(200, "Current Geography responsibilities fetched", { assignments }));
  } catch (error) { next(error); }
};

module.exports = {
  getReadinessController,
  getAssignmentTreeController,
  getCompatibleGeographiesController,
  previewAssignmentController,
  assignController,
  endAssignmentController,
  getCurrentController,
  getMineController,
  getHistoryController,
  getGeographyAssignmentsController,
};
