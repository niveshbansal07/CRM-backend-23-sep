const ApiResponse = require("../utils/ApiResponse");
const {
  getTodayAttendance,
  punchIn,
  punchOut,
  getMyMonthlyAttendance,
  getCompanyDailyAttendance,
  getCompanyMonthlyAttendance,
  processDailyAttendance,
  getPayrollReadySummary,
} = require("../services/attendance.service");
const {
  applyCorrectionRequest,
  getMyCorrectionRequests,
  getPendingCorrections,
  approveCorrection,
  rejectCorrection,
} = require("../services/attendanceCorrection.service");

const getTodayAttendanceController = async (req, res, next) => {
  try {
    const data = await getTodayAttendance({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Today's attendance fetched successfully", data));
  } catch (error) {
    next(error);
  }
};

const punchInController = async (req, res, next) => {
  try {
    const attendance = await punchIn({ user: req.user, body: req.body, req });
    res.status(201).json(new ApiResponse(201, "Punch-in recorded successfully", { attendance }));
  } catch (error) {
    next(error);
  }
};

const punchOutController = async (req, res, next) => {
  try {
    const attendance = await punchOut({ user: req.user, body: req.body, req });
    res.status(200).json(new ApiResponse(200, "Punch-out recorded successfully", { attendance }));
  } catch (error) {
    next(error);
  }
};

const getMyMonthlyAttendanceController = async (req, res, next) => {
  try {
    const data = await getMyMonthlyAttendance({ user: req.user, month: req.query.month });
    res.status(200).json(new ApiResponse(200, "Monthly attendance fetched successfully", data));
  } catch (error) {
    next(error);
  }
};

const getCompanyDailyAttendanceController = async (req, res, next) => {
  try {
    const records = await getCompanyDailyAttendance({ user: req.user, date: req.query.date });
    res.status(200).json(new ApiResponse(200, "Daily attendance fetched successfully", { records }));
  } catch (error) {
    next(error);
  }
};

const getCompanyMonthlyAttendanceController = async (req, res, next) => {
  try {
    const data = await getCompanyMonthlyAttendance({ user: req.user, month: req.query.month });
    res.status(200).json(new ApiResponse(200, "Company monthly attendance fetched successfully", data));
  } catch (error) {
    next(error);
  }
};

const processDailyAttendanceController = async (req, res, next) => {
  try {
    const records = await processDailyAttendance({ user: req.user, date: req.body?.date || req.query.date });
    res.status(200).json(new ApiResponse(200, "Daily attendance processed successfully", { count: records.length, records }));
  } catch (error) {
    next(error);
  }
};

const getPayrollReadySummaryController = async (req, res, next) => {
  try {
    const summary = await getPayrollReadySummary({
      user: req.user,
      employeeId: req.query.employeeId,
      month: req.query.month,
    });
    res.status(200).json(new ApiResponse(200, "Payroll-ready summary fetched successfully", { summary }));
  } catch (error) {
    next(error);
  }
};

const applyCorrectionController = async (req, res, next) => {
  try {
    const request = await applyCorrectionRequest({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Correction request submitted successfully", { request }));
  } catch (error) {
    next(error);
  }
};

const getMyCorrectionsController = async (req, res, next) => {
  try {
    const requests = await getMyCorrectionRequests({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Correction requests fetched successfully", { requests }));
  } catch (error) {
    next(error);
  }
};

const getPendingCorrectionsController = async (req, res, next) => {
  try {
    const requests = await getPendingCorrections({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Pending correction requests fetched successfully", { requests }));
  } catch (error) {
    next(error);
  }
};

const approveCorrectionController = async (req, res, next) => {
  try {
    const request = await approveCorrection({
      user: req.user,
      requestId: req.params.id,
      comment: req.validatedBody?.comment || "",
      req,
    });
    res.status(200).json(new ApiResponse(200, "Correction request approved successfully", { request }));
  } catch (error) {
    next(error);
  }
};

const rejectCorrectionController = async (req, res, next) => {
  try {
    const request = await rejectCorrection({
      user: req.user,
      requestId: req.params.id,
      reason: req.validatedBody?.reason || "",
      req,
    });
    res.status(200).json(new ApiResponse(200, "Correction request rejected successfully", { request }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTodayAttendanceController,
  punchInController,
  punchOutController,
  getMyMonthlyAttendanceController,
  getCompanyDailyAttendanceController,
  getCompanyMonthlyAttendanceController,
  processDailyAttendanceController,
  getPayrollReadySummaryController,
  applyCorrectionController,
  getMyCorrectionsController,
  getPendingCorrectionsController,
  approveCorrectionController,
  rejectCorrectionController,
};
