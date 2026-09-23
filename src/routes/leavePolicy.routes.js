const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles, ATTENDANCE_POLICY_ROLES } = require("../middlewares/role.middleware");
const {
  listLeavePoliciesController,
  createLeavePolicyController,
  updateLeavePolicyController,
} = require("../controllers/leavePolicy.controller");
const { validateObjectIdParam } = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", allowRoles(...ATTENDANCE_POLICY_ROLES, "hr_head", "hr_manager"), listLeavePoliciesController);
router.post("/", allowRoles(...ATTENDANCE_POLICY_ROLES), createLeavePolicyController);
router.patch("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), updateLeavePolicyController);

module.exports = router;

