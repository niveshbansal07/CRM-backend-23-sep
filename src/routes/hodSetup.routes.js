const express = require("express");
const {
  listDepartmentHodStatusesController,
  createDepartmentHodController,
} = require("../controllers/hodSetup.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  validateHodDepartmentId,
  validateHodSetupPayload,
} = require("../validators/hodSetup.validator");

const router = express.Router();

router.use(authenticate);
router.use(allowRoles("company_admin"));

router.get("/departments", listDepartmentHodStatusesController);
router.post(
  "/departments/:departmentId",
  validateHodDepartmentId,
  validateHodSetupPayload,
  createDepartmentHodController
);

module.exports = router;
