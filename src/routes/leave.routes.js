const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const {
  allowRoles,
  EMPLOYEE_SELF_SERVICE_ROLES,
  LEAVE_APPROVER_ROLES,
  ATTENDANCE_POLICY_ROLES,
} = require("../middlewares/role.middleware");
const {
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
} = require("../controllers/leave.controller");
const {
  validateLeaveTypePayload,
  validateLeaveApplyPayload,
  validateLeaveReview,
} = require("../validators/leave.validator");
const { validateObjectIdParam } = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/types", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES, ...LEAVE_APPROVER_ROLES), listLeaveTypesController);
router.post("/types", allowRoles(...ATTENDANCE_POLICY_ROLES), validateLeaveTypePayload, createLeaveTypeController);
router.patch("/types/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), validateLeaveTypePayload, updateLeaveTypeController);
router.delete("/types/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), deleteLeaveTypeController);

router.get("/me/balance", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyLeaveBalanceController);
router.post("/apply", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), validateLeaveApplyPayload, applyLeaveController);
router.get("/me/requests", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyLeaveRequestsController);
router.get("/my", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyLeaveRequestsController);

router.get("/pending-approvals", allowRoles(...LEAVE_APPROVER_ROLES), getPendingLeaveApprovalsController);
router.get("/pending", allowRoles(...LEAVE_APPROVER_ROLES), getPendingLeaveApprovalsController);
router.patch("/:id/approve", allowRoles(...LEAVE_APPROVER_ROLES), validateObjectIdParam("id"), validateLeaveReview, approveLeaveController);
router.patch("/:id/reject", allowRoles(...LEAVE_APPROVER_ROLES), validateObjectIdParam("id"), validateLeaveReview, rejectLeaveController);
router.patch("/:id/cancel-request", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), validateObjectIdParam("id"), validateLeaveReview, requestLeaveCancellationController);
router.patch("/:id/cancel-approve", allowRoles(...LEAVE_APPROVER_ROLES), validateObjectIdParam("id"), validateLeaveReview, approveLeaveCancellationController);

router.get("/report", allowRoles(...LEAVE_APPROVER_ROLES, "hr_general", "hr_executive"), getLeaveReportController);

module.exports = router;

