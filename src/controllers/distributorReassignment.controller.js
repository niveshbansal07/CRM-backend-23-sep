const ApiResponse = require("../utils/ApiResponse");
const {
  buildReassignmentPreview,
  createReassignmentRequest,
  approveReassignmentRequest,
  rejectReassignmentRequest,
  cancelReassignmentRequest,
  listReassignmentRequests,
  listApprovalQueue,
  getReassignmentRequest,
  listEligibleReassignmentFsds,
  listEligibleFsdsForArea,
  listTransferOptions,
  listReassignmentReadiness,
  getReassignmentHistory,
} = require("../services/distributorReassignment.service");

const action = (handler, statusCode, message) => async (req, res, next) => {
  try {
    const result = await handler({
      payload: req.body,
      query: req.query,
      requestId: req.params.requestId,
      accountId: req.params.accountId,
      at: req.query.at,
      user: req.user,
      req,
    });
    res.status(statusCode).json(new ApiResponse(statusCode, message, result));
  } catch (error) { next(error); }
};

module.exports = {
  readinessController: action(listReassignmentReadiness, 200, "Distributor reassignment readiness fetched successfully"),
  previewController: action(buildReassignmentPreview, 200, "Distributor reassignment preview generated"),
  createController: action(createReassignmentRequest, 201, "Distributor reassignment request created"),
  listController: action(listReassignmentRequests, 200, "Distributor reassignment requests fetched successfully"),
  getController: action(getReassignmentRequest, 200, "Distributor reassignment request fetched successfully"),
  eligibleController: action(async ({ accountId, user }) => ({ fsds: await listEligibleReassignmentFsds({ accountId, user }) }), 200, "Eligible same-Area Primary FSDs fetched successfully"),
  areaEligibleController: action(async ({ req, user }) => ({ fsds: await listEligibleFsdsForArea({ areaId: req.params.areaId, user }) }), 200, "Eligible destination Primary FSDs fetched successfully"),
  transferOptionsController: action(async ({ user }) => ({ areas: await listTransferOptions({ user }) }), 200, "Distributor transfer options fetched successfully"),
  approvalQueueController: action(async ({ user }) => ({ requests: await listApprovalQueue({ user }) }), 200, "Distributor approval queue fetched successfully"),
  approveController: action(approveReassignmentRequest, 200, "Distributor reassignment approved and applied"),
  rejectController: action(rejectReassignmentRequest, 200, "Distributor reassignment request rejected"),
  cancelController: action(cancelReassignmentRequest, 200, "Distributor reassignment request cancelled"),
  historyController: action(getReassignmentHistory, 200, "Distributor reassignment history fetched successfully"),
};
