const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const { REASSIGNMENT_ROLES } = require("../constants/distributorReassignment");
const {
  validateIntent,
  requireTransferDestination,
  validateDecision,
  validateRequestId,
  validateAccountId,
  validateAreaId,
  validateListQuery,
} = require("../validators/distributorReassignment.validator");
const controller = require("../controllers/distributorReassignment.controller");

const router = express.Router();
router.use(authenticate);
router.use(allowRoles(...REASSIGNMENT_ROLES));

router.get("/readiness", controller.readinessController);
router.post("/preview", validateIntent, controller.previewController);
router.post("/transfer-preview", validateIntent, requireTransferDestination, controller.previewController);
router.post("/requests", validateIntent, controller.createController);
router.get("/requests", validateListQuery, controller.listController);
router.get("/approval-queue", controller.approvalQueueController);
router.get("/transfer-options", controller.transferOptionsController);
router.get("/history", controller.historyController);
router.get("/areas/:areaId/eligible-fsds", validateAreaId, controller.areaEligibleController);
router.get("/distributors/:accountId/eligible-fsds", validateAccountId, controller.eligibleController);
router.get("/distributors/:accountId/history", validateAccountId, controller.historyController);
router.get("/requests/:requestId", validateRequestId, controller.getController);
router.post("/requests/:requestId/approve", validateRequestId, validateDecision, controller.approveController);
router.post("/requests/:requestId/reject", validateRequestId, validateDecision, controller.rejectController);
router.post("/requests/:requestId/cancel", validateRequestId, validateDecision, controller.cancelController);

module.exports = router;
