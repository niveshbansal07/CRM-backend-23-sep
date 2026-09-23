const express = require("express");
const {
  getHrHeadDashboardController,
  getHrHeadTeamController,
  getHrHeadDesignationsController,
  createHrHeadDesignationController,
  updateHrHeadDesignationController,
  getHrHeadReportsController,
} = require("../controllers/hrHead.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");

const router = express.Router();

router.use(authenticate);
router.use(allowRoles("hr_head"));

router.get("/dashboard", getHrHeadDashboardController);
router.get("/team", getHrHeadTeamController);
router.get("/designations", getHrHeadDesignationsController);
router.post("/designations", createHrHeadDesignationController);
router.patch("/designations/:designationId", updateHrHeadDesignationController);
router.get("/reports", getHrHeadReportsController);

module.exports = router;

