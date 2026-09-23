const ApiResponse = require("../utils/ApiResponse");
const {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  softDeleteLeaveType,
  getMyLeaveBalance,
  applyLeave,
  getMyLeaveRequests,
  getPendingLeaveApprovals,
  approveLeave,
  rejectLeave,
  requestLeaveCancellation,
  approveLeaveCancellation,
  getLeaveReport,
} = require("../services/leave.service");

const listLeaveTypesController = async (req, res, next) => {
  try {
    const leaveTypes = await listLeaveTypes({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Leave types fetched successfully", { leaveTypes }));
  } catch (error) {
    next(error);
  }
};

const createLeaveTypeController = async (req, res, next) => {
  try {
    const leaveType = await createLeaveType({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Leave type created successfully", { leaveType }));
  } catch (error) {
    next(error);
  }
};

const updateLeaveTypeController = async (req, res, next) => {
  try {
    const leaveType = await updateLeaveType({
      user: req.user,
      leaveTypeId: req.params.id,
      payload: req.validatedBody,
      req,
    });
    res.status(200).json(new ApiResponse(200, "Leave type updated successfully", { leaveType }));
  } catch (error) {
    next(error);
  }
};

const deleteLeaveTypeController = async (req, res, next) => {
  try {
    await softDeleteLeaveType({ user: req.user, leaveTypeId: req.params.id, req });
    res.status(200).json(new ApiResponse(200, "Leave type deleted successfully", null));
  } catch (error) {
    next(error);
  }
};

const getMyLeaveBalanceController = async (req, res, next) => {
  try {
    const balances = await getMyLeaveBalance({ user: req.user, year: req.query.year });
    res.status(200).json(new ApiResponse(200, "Leave balance fetched successfully", { balances }));
  } catch (error) {
    next(error);
  }
};

const applyLeaveController = async (req, res, next) => {
  try {
    const leaveRequest = await applyLeave({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Leave request submitted successfully", { leaveRequest }));
  } catch (error) {
    next(error);
  }
};

const getMyLeaveRequestsController = async (req, res, next) => {
  try {
    const requests = await getMyLeaveRequests({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Leave requests fetched successfully", { requests }));
  } catch (error) {
    next(error);
  }
};

const getPendingLeaveApprovalsController = async (req, res, next) => {
  try {
    const requests = await getPendingLeaveApprovals({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Pending leave approvals fetched successfully", { requests }));
  } catch (error) {
    next(error);
  }
};

const approveLeaveController = async (req, res, next) => {
  try {
    const leaveRequest = await approveLeave({
      user: req.user,
      leaveId: req.params.id,
      comment: req.validatedBody?.comment || "",
      req,
    });
    res.status(200).json(new ApiResponse(200, "Leave request approved successfully", { leaveRequest }));
  } catch (error) {
    next(error);
  }
};

const rejectLeaveController = async (req, res, next) => {
  try {
    const leaveRequest = await rejectLeave({
      user: req.user,
      leaveId: req.params.id,
      reason: req.validatedBody?.reason || "",
      req,
    });
    res.status(200).json(new ApiResponse(200, "Leave request rejected successfully", { leaveRequest }));
  } catch (error) {
    next(error);
  }
};

const requestLeaveCancellationController = async (req, res, next) => {
  try {
    const leaveRequest = await requestLeaveCancellation({
      user: req.user,
      leaveId: req.params.id,
      comment: req.validatedBody?.comment || "",
    });
    res.status(200).json(new ApiResponse(200, "Leave cancellation requested successfully", { leaveRequest }));
  } catch (error) {
    next(error);
  }
};

const approveLeaveCancellationController = async (req, res, next) => {
  try {
    const leaveRequest = await approveLeaveCancellation({
      user: req.user,
      leaveId: req.params.id,
      comment: req.validatedBody?.comment || "",
      req,
    });
    res.status(200).json(new ApiResponse(200, "Leave cancellation approved successfully", { leaveRequest }));
  } catch (error) {
    next(error);
  }
};

const getLeaveReportController = async (req, res, next) => {
  try {
    const requests = await getLeaveReport({ user: req.user, month: req.query.month });
    res.status(200).json(new ApiResponse(200, "Leave report fetched successfully", { requests }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listLeaveTypesController,
  createLeaveTypeController,
  updateLeaveTypeController,
  deleteLeaveTypeController,
  getMyLeaveBalanceController,
  applyLeaveController,
  getMyLeaveRequestsController,
  getPendingLeaveApprovalsController,
  approveLeaveController,
  rejectLeaveController,
  requestLeaveCancellationController,
  approveLeaveCancellationController,
  getLeaveReportController,
};
