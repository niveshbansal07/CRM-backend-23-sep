const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const { DISTRIBUTOR_MAPPING_MANAGE_ROLES } = require("../constants/distributorSalesMapping");
const {
  validateInitialMapping,
  validateAccountId,
  validateAreaId,
} = require("../validators/distributorSalesMapping.validator");
const {
  readinessController,
  detailsController,
  eligibleFsdsController,
  previewController,
  applyController,
} = require("../controllers/distributorSalesMapping.controller");

const router = express.Router();
router.use(authenticate);
router.use(allowRoles(...DISTRIBUTOR_MAPPING_MANAGE_ROLES));

router.get("/readiness", readinessController);
router.get("/areas/:areaId/eligible-fsds", validateAreaId, eligibleFsdsController);
router.post("/preview", validateInitialMapping, previewController);
router.post("/apply", validateInitialMapping, applyController);
router.get("/:accountId/ownership-chain", validateAccountId, detailsController);
router.get("/:accountId", validateAccountId, detailsController);

module.exports = router;
