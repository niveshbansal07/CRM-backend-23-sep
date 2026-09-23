const express = require("express");
const {
    listPendingRequestsForManager,
    approveRequest,
    rejectRequest,
} = require("../controllers/employeeRequest.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowHrManager } = require("../middlewares/role.middleware");
const { validateReviewPayload } = require("../validators/employeeRequest.validator");

const router = express.Router();

router.use(authenticate);

router.get("/pending", allowHrManager, listPendingRequestsForManager);
router.patch("/:id/approve", allowHrManager, validateReviewPayload, approveRequest);
router.patch("/:id/reject", allowHrManager, validateReviewPayload, rejectRequest);

module.exports = router;

