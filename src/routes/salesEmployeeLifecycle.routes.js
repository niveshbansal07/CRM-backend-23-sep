const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const { SALES_ASSIGNMENT_MANAGE_ROLES } = require("../constants/salesGeographyAssignment");
const { validateObjectIdParam } = require("../validators/salesGeographyAssignment.validator");
const {
  validateTransferPayload,
  validateReason,
  validateOffboarding,
  validateManagerCandidateQuery,
} = require("../validators/salesEmployeeLifecycle.validator");
const {
  previewTransferController,
  applyTransferController,
  getManagerCandidatesController,
  previewEndController,
  applyEndController,
  getHistoryController,
  previewOffboardingController,
  applyOffboardingController,
} = require("../controllers/salesEmployeeLifecycle.controller");

const router = express.Router();
router.use(authenticate);

router.post("/preview", allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES), validateTransferPayload, previewTransferController);
router.post("/apply", allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES), validateTransferPayload, applyTransferController);
router.get(
  "/employees/:employeeId/manager-candidates",
  allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES),
  validateObjectIdParam("employeeId"),
  validateManagerCandidateQuery,
  getManagerCandidatesController
);
router.post(
  "/employees/:employeeId/end-preview",
  allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES),
  validateObjectIdParam("employeeId"),
  validateReason,
  previewEndController
);
router.post(
  "/employees/:employeeId/end",
  allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES),
  validateObjectIdParam("employeeId"),
  validateReason,
  applyEndController
);
router.get(
  "/employees/:employeeId/history",
  allowRoles(...SALES_ASSIGNMENT_MANAGE_ROLES),
  validateObjectIdParam("employeeId"),
  getHistoryController
);
router.post(
  "/employees/:employeeId/offboarding-preview",
  allowRoles("super_admin", "company_admin", "sub_admin"),
  validateObjectIdParam("employeeId"),
  validateOffboarding,
  previewOffboardingController
);
router.post(
  "/employees/:employeeId/offboarding-apply",
  allowRoles("super_admin", "company_admin", "sub_admin"),
  validateObjectIdParam("employeeId"),
  validateOffboarding,
  applyOffboardingController
);

module.exports = router;
