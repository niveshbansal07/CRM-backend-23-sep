const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const {
  allowRoles,
  EMPLOYEE_SELF_SERVICE_ROLES,
  ATTENDANCE_CORRECTION_APPROVER_ROLES,
} = require("../middlewares/role.middleware");
const {
  applyCorrectionController,
  getMyCorrectionsController,
  getPendingCorrectionsController,
  approveCorrectionController,
  rejectCorrectionController,
} = require("../controllers/attendance.controller");
const {
  validateCorrectionRequest,
  validateReview,
  validateObjectIdParam,
} = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.post("/apply", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), validateCorrectionRequest, applyCorrectionController);
router.get("/my", allowRoles(...EMPLOYEE_SELF_SERVICE_ROLES), getMyCorrectionsController);
router.get("/pending", allowRoles(...ATTENDANCE_CORRECTION_APPROVER_ROLES), getPendingCorrectionsController);
router.patch("/:id/approve", allowRoles(...ATTENDANCE_CORRECTION_APPROVER_ROLES), validateObjectIdParam("id"), validateReview, approveCorrectionController);
router.patch("/:id/reject", allowRoles(...ATTENDANCE_CORRECTION_APPROVER_ROLES), validateObjectIdParam("id"), validateReview, rejectCorrectionController);

module.exports = router;

