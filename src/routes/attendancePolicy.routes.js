const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles, ATTENDANCE_POLICY_ROLES } = require("../middlewares/role.middleware");
const {
  listPoliciesController,
  createPolicyController,
  updatePolicyController,
} = require("../controllers/attendancePolicy.controller");
const {
  validatePolicyPayload,
  validateObjectIdParam,
} = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", allowRoles(...ATTENDANCE_POLICY_ROLES, "hr_head", "hr_manager"), listPoliciesController);
router.post("/", allowRoles(...ATTENDANCE_POLICY_ROLES), validatePolicyPayload, createPolicyController);
router.patch("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), validatePolicyPayload, updatePolicyController);

module.exports = router;

