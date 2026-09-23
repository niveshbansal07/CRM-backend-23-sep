const express = require("express");
const {
    createRequest,
    listRequests,
    listMyRequests,
    listAssignedRequests,
    getRequestStats,
    approveRequest,
    rejectRequest,
} = require("../controllers/employeeRequest.controller");
const { setupEmployeeFromRequestController } = require("../controllers/user.controller");

const { authenticate } = require("../middlewares/auth.middleware");
const {
    allowEmployeeRequestCreate,
    allowEmployeeRequestReview,
    allowRoles,
} = require("../middlewares/role.middleware");
const {
    validateEmployeeRequestPayload,
    validateReviewPayload,
} = require("../validators/employeeRequest.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", listRequests);
router.get("/my", listMyRequests);
router.get("/assigned", allowEmployeeRequestReview, listAssignedRequests);
router.get("/stats", allowRoles("hr_head", "hr_manager", "company_admin", "sub_admin"), getRequestStats);

router.post("/", allowEmployeeRequestCreate, validateEmployeeRequestPayload, createRequest);

router.patch("/:id/approve", allowEmployeeRequestReview, validateReviewPayload, approveRequest);

router.patch("/:id/reject", allowEmployeeRequestReview, validateReviewPayload, rejectRequest);
router.patch("/:id/decline", allowEmployeeRequestReview, validateReviewPayload, rejectRequest);
router.post("/:id/setup", allowEmployeeRequestCreate, (req, res, next) => {
    req.body = {
        ...(req.body || {}),
        sourceRequestId: req.params.id,
    };
    return setupEmployeeFromRequestController(req, res, next);
});

module.exports = router;
