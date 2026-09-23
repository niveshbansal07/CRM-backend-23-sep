const express = require("express");
const {
    getDefaultOrgTreeController,
    getMyOrgTreeController,
    getCompanyOrgTreeController,
    exportCompanyOrgTreeController,
    getOrgTreeGapsController,
    getDepartmentOrgTreeController,
    getUserDownlineTreeController,
    getAllowedManagersController,
} = require("../controllers/orgTree.controller");
const { authenticate } = require("../middlewares/auth.middleware");

const router = express.Router();

router.use(authenticate);

router.get("/default", getDefaultOrgTreeController);
router.get("/me", getMyOrgTreeController);
router.get("/company", getCompanyOrgTreeController);
router.get("/export", exportCompanyOrgTreeController);
router.get("/gaps", getOrgTreeGapsController);
router.get("/department/:departmentId", getDepartmentOrgTreeController);
router.get("/user/:userId/downline", getUserDownlineTreeController);
router.get("/allowed-managers", getAllowedManagersController);

module.exports = router;
