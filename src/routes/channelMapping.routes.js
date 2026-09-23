const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const { CHANNEL_MAPPING_MANAGE_ROLES, CHANNEL_MAPPING_READ_ROLES } = require("../constants/channelMapping");
const { validateMappingIntent, validateAccountId } = require("../validators/channelMapping.validator");
const controller = require("../controllers/channelMapping.controller");

const router = express.Router();
router.use(authenticate);

router.get("/readiness", allowRoles(...CHANNEL_MAPPING_MANAGE_ROLES), controller.readinessController);
router.post("/preview", allowRoles(...CHANNEL_MAPPING_MANAGE_ROLES), validateMappingIntent, controller.previewController);
router.post("/apply", allowRoles(...CHANNEL_MAPPING_MANAGE_ROLES), validateMappingIntent, controller.applyController);
router.get("/dealers/:accountId/hierarchy", allowRoles(...CHANNEL_MAPPING_READ_ROLES), validateAccountId, controller.dealerHierarchyController);
router.get("/retailers/:accountId/hierarchy", allowRoles(...CHANNEL_MAPPING_READ_ROLES), validateAccountId, controller.retailerHierarchyController);
router.get("/customers/:accountId/hierarchy", allowRoles(...CHANNEL_MAPPING_READ_ROLES), validateAccountId, controller.customerHierarchyController);
router.get("/distributors/:distributorAccountId/channel-accounts", allowRoles(...CHANNEL_MAPPING_READ_ROLES), validateAccountId, controller.distributorAccountsController);

module.exports = router;
