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
} = require("../controllers/leave.controller");
const { validateLeaveTypePayload } = require("../validators/leave.validator");
const { validateObjectIdParam } = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES, ...LEAVE_APPROVER_ROLES), listLeaveTypesController);
router.post("/", allowRoles(...ATTENDANCE_POLICY_ROLES), validateLeaveTypePayload, createLeaveTypeController);
router.patch("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), validateLeaveTypePayload, updateLeaveTypeController);
router.put("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), validateLeaveTypePayload, updateLeaveTypeController);
router.delete("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), deleteLeaveTypeController);

module.exports = router;

