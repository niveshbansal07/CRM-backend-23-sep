const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const { SALES_GEOGRAPHY_MANAGE_ROLES } = require("../constants/salesGeography");
const {
  getTreeController,
  listZonesController,
  listRegionsController,
  listBranchesController,
  listAreasController,
  getGeographyController,
  createGeographyController,
  updateGeographyController,
  updateGeographyStatusController,
} = require("../controllers/salesGeography.controller");
const {
  validateSalesGeographyCreate,
  validateSalesGeographyUpdate,
  validateSalesGeographyStatus,
  validateObjectIdParam,
} = require("../validators/salesGeography.validator");

const router = express.Router();

router.use(authenticate);
router.use(allowRoles(...SALES_GEOGRAPHY_MANAGE_ROLES));

router.get("/tree", getTreeController);
router.get("/zones", listZonesController);
router.get("/zones/:parentId/regions", validateObjectIdParam("parentId"), listRegionsController);
router.get("/regions/:parentId/branches", validateObjectIdParam("parentId"), listBranchesController);
router.get("/branches/:parentId/areas", validateObjectIdParam("parentId"), listAreasController);
router.post("/", validateSalesGeographyCreate, createGeographyController);
router.get("/:id", validateObjectIdParam("id"), getGeographyController);
router.patch("/:id", validateObjectIdParam("id"), validateSalesGeographyUpdate, updateGeographyController);
router.patch(
  "/:id/status",
  validateObjectIdParam("id"),
  validateSalesGeographyStatus,
  updateGeographyStatusController
);

module.exports = router;
