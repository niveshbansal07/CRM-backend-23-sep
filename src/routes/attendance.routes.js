const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const {
  allowRoles,
  EMPLOYEE_SELF_SERVICE_ROLES,
  ATTENDANCE_VIEW_ROLES,
  ATTENDANCE_MANAGE_ROLES,
  ATTENDANCE_CORRECTION_APPROVER_ROLES,
} = require("../middlewares/role.middleware");
const punchRateLimiter = require("../middlewares/punchRateLimiter.middleware");
const {
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
} = require("../controllers/attendance.controller");
const {
  validateCorrectionRequest,
  validateReview,
  validateDateQuery,
  validateObjectIdParam,
} = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.post("/punch-in", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), punchRateLimiter, punchInController);
router.post("/punch-out", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), punchRateLimiter, punchOutController);
router.get("/me/today", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getTodayAttendanceController);
router.get("/today", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getTodayAttendanceController);
router.get("/me/monthly", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyMonthlyAttendanceController);
router.get("/my", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyMonthlyAttendanceController);

router.get("/company/daily", allowRoles(...ATTENDANCE_VIEW_ROLES), validateDateQuery, getCompanyDailyAttendanceController);
router.get("/team", allowRoles(...ATTENDANCE_VIEW_ROLES), validateDateQuery, getCompanyDailyAttendanceController);
router.get("/company/monthly", allowRoles(...ATTENDANCE_VIEW_ROLES), getCompanyMonthlyAttendanceController);
router.get("/company-report", allowRoles(...ATTENDANCE_VIEW_ROLES, "company_admin", "sub_admin"), getCompanyMonthlyAttendanceController);
router.get("/payroll-summary", allowRoles(...ATTENDANCE_MANAGE_ROLES), getPayrollReadySummaryController);
router.post("/process-daily", allowRoles(...ATTENDANCE_MANAGE_ROLES), processDailyAttendanceController);

router.post("/correction-request", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), validateCorrectionRequest, applyCorrectionController);
router.post("/correction/apply", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), validateCorrectionRequest, applyCorrectionController);
router.get("/correction/my", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyCorrectionsController);
router.get("/correction/pending", allowRoles(...ATTENDANCE_CORRECTION_APPROVER_ROLES), getPendingCorrectionsController);
router.patch("/correction/:id/approve", allowRoles(...ATTENDANCE_CORRECTION_APPROVER_ROLES), validateObjectIdParam("id"), validateReview, approveCorrectionController);
router.patch("/correction/:id/reject", allowRoles(...ATTENDANCE_CORRECTION_APPROVER_ROLES), validateObjectIdParam("id"), validateReview, rejectCorrectionController);

module.exports = router;

