const express = require("express");
const { getEligibleReportingManagersController } = require("../controllers/reportingManager.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");

const router = express.Router();

router.use(authenticate);

router.get(
    "/eligible",
    allowRoles("company_admin", "sub_admin", "hr_head", "hr_manager", "hr_general", "hr_executive"),
    getEligibleReportingManagersController
);

module.exports = router;

