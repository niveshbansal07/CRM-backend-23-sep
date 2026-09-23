const express = require("express");
const {
  listDesignationsController,
  listDesignationsByDepartmentController,
  listDefaultDesignationSeedsController,
  getDesignationController,
  createDesignationController,
  bulkCreateDefaultDesignationsController,
  updateDesignationController,
  updateDesignationStatusController,
  archiveDesignationController,
  previewSalesHierarchyController,
  applySalesHierarchyController,
} = require("../controllers/designation.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowDesignationManage, allowOrgStructureRead } = require("../middlewares/role.middleware");
const {
  validateDesignationPayload,
  validateDesignationUpdatePayload,
  validateDesignationStatus,
  validateDefaultDesignationSelection,
  validateDesignationArchive,
  validateObjectIdParam,
} = require("../validators/designation.validator");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  allowOrgStructureRead,
  listDesignationsController
);

router.get(
  "/by-department/:departmentId",
  allowOrgStructureRead,
  validateObjectIdParam("departmentId"),
  listDesignationsByDepartmentController
);

router.get(
  "/default-seeds/:departmentId",
  allowDesignationManage,
  validateObjectIdParam("departmentId"),
  listDefaultDesignationSeedsController
);

router.post(
  "/bulk-defaults",
  allowDesignationManage,
  validateDefaultDesignationSelection,
  bulkCreateDefaultDesignationsController
);

router.post(
  "/",
  allowDesignationManage,
  validateDesignationPayload,
  createDesignationController
);

router.get(
  "/sales-hierarchy/preview",
  allowDesignationManage,
  previewSalesHierarchyController
);

router.post(
  "/sales-hierarchy/apply",
  allowDesignationManage,
  applySalesHierarchyController
);

router.get(
  "/:id",
  allowOrgStructureRead,
  validateObjectIdParam("id"),
  getDesignationController
);

router.patch(
  "/:id",
  allowDesignationManage,
  validateObjectIdParam("id"),
  validateDesignationUpdatePayload,
  updateDesignationController
);

router.put(
  "/:id",
  allowDesignationManage,
  validateObjectIdParam("id"),
  validateDesignationUpdatePayload,
  updateDesignationController
);

router.patch(
  "/:id/archive",
  allowDesignationManage,
  validateObjectIdParam("id"),
  validateDesignationArchive,
  archiveDesignationController
);

router.patch(
  "/:id/status",
  allowDesignationManage,
  validateObjectIdParam("id"),
  validateDesignationStatus,
  updateDesignationStatusController
);

module.exports = router;
