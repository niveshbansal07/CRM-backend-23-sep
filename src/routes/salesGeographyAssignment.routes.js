const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  SALES_ASSIGNMENT_MANAGE_ROLES,
  SALES_ASSIGNMENT_OWN_READ_ROLES,
} = require("../constants/salesGeographyAssignment");
const {
  validateAssignmentPreview,
  validateAssignmentApply,
  validateEndAssignment,
  validateObjectIdParam,
} = require("../validators/salesGeographyAssignment.validator");
const {
  getReadinessController,
  getAssignmentTreeController,
  getCompatibleGeographiesController,
  previewAssignmentController,
  assignController,
  endAssignmentController,
  getCurrentController,
  getMineController,
  getHistoryController,
  getGeographyAssignmentsController,
} = require("../controllers/salesGeographyAssignment.controller");

const router = express.Router();

router.use(authenticate);
router.get("/mine", allowRoles(...SALES_ASSIGNMENT_OWN_READ_ROLES), getMineController);

router.use(allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES));
router.get("/readiness", getReadinessController);
router.get("/tree", getAssignmentTreeController);
router.get(
  "/employees/:employeeId/compatible-geographies",
  validateObjectIdParam("employeeId"),
  getCompatibleGeographiesController
);
router.post("/preview", validateAssignmentPreview, previewAssignmentController);
router.post("/assign", validateAssignmentApply, assignController);
router.get(
  "/employees/:employeeId/current",
  validateObjectIdParam("employeeId"),
  getCurrentController
);
router.get(
  "/employees/:employeeId/history",
  validateObjectIdParam("employeeId"),
  getHistoryController
);
router.post(
  "/employees/:employeeId/end",
  validateObjectIdParam("employeeId"),
  validateEndAssignment,
  endAssignmentController
);
router.get(
  "/geographies/:geographyId/current",
  validateObjectIdParam("geographyId"),
  getGeographyAssignmentsController
);

module.exports = router;
