const express = require("express");
const {
    createRequest,
    listRequests,
    listApprovedRequests,
    createEmployeeFromRequest,
} = require("../controllers/employeeRequest.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const {
    allowHrExecutive,
    allowHrRequestViewer,
} = require("../middlewares/role.middleware");
const {
    validateEmployeeRequestPayload,
} = require("../validators/employeeRequest.validator");

const router = express.Router();

router.use(authenticate);

router.post("/", allowHrExecutive, validateEmployeeRequestPayload, createRequest);
router.get("/", allowHrRequestViewer, listRequests);
router.get("/approved", allowHrRequestViewer, listApprovedRequests);
router.post("/:requestId/create-employee", allowHrRequestViewer, createEmployeeFromRequest);

module.exports = router;

