const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles, ATTENDANCE_POLICY_ROLES } = require("../middlewares/role.middleware");
const {
  listWeeklyOffPoliciesController,
  createWeeklyOffPolicyController,
  updateWeeklyOffPolicyController,
} = require("../controllers/weeklyOffPolicy.controller");
const { validateObjectIdParam } = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", allowRoles(...ATTENDANCE_POLICY_ROLES, "hr_head", "hr_manager"), listWeeklyOffPoliciesController);
router.post("/", allowRoles(...ATTENDANCE_POLICY_ROLES), createWeeklyOffPolicyController);
router.patch("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), updateWeeklyOffPolicyController);

module.exports = router;

