const express = require("express");
const {
  getHrSetupStatusController,
  createHrHeadController,
} = require("../controllers/hrSetup.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");

const router = express.Router();

router.use(authenticate);
router.use(allowRoles("company_admin", "sub_admin"));

router.get("/status", getHrSetupStatusController);
router.post("/hr-head", createHrHeadController);

module.exports = router;

