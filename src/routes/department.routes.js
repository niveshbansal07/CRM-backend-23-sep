const express = require("express");
const {
  listDepartmentsController,
  listActiveDepartmentsController,
  listDefaultDepartmentSeedsController,
  getDepartmentController,
  createDepartmentController,
  bulkCreateDefaultDepartmentsController,
  updateDepartmentController,
  updateDepartmentStatusController,
  archiveDepartmentController,
} = require("../controllers/department.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowDepartmentManage, allowOrgStructureRead } = require("../middlewares/role.middleware");
const {
  validateDepartmentPayload,
  validateDepartmentStatus,
  validateDefaultDepartmentSelection,
  validateDepartmentArchive,
  validateObjectIdParam,
} = require("../validators/department.validator");

const router = express.Router();

router.use(authenticate);

router.get(
  "/",
  allowOrgStructureRead,
  listDepartmentsController
);

router.get(
  "/active",
  allowOrgStructureRead,
  listActiveDepartmentsController
);

router.get(
  "/default-seeds",
  allowDepartmentManage,
  listDefaultDepartmentSeedsController
);

router.post(
  "/bulk-defaults",
  allowDepartmentManage,
  validateDefaultDepartmentSelection,
  bulkCreateDefaultDepartmentsController
);

router.post(
  "/",
  allowDepartmentManage,
  validateDepartmentPayload,
  createDepartmentController
);

router.get(
  "/:id",
  allowOrgStructureRead,
  validateObjectIdParam("id"),
  getDepartmentController
);

router.patch(
  "/:id",
  allowDepartmentManage,
  validateObjectIdParam("id"),
  validateDepartmentPayload,
  updateDepartmentController
);

router.put(
  "/:id",
  allowDepartmentManage,
  validateObjectIdParam("id"),
  validateDepartmentPayload,
  updateDepartmentController
);

router.patch(
  "/:id/archive",
  allowDepartmentManage,
  validateObjectIdParam("id"),
  validateDepartmentArchive,
  archiveDepartmentController
);

router.patch(
  "/:id/status",
  allowDepartmentManage,
  validateObjectIdParam("id"),
  validateDepartmentStatus,
  updateDepartmentStatusController
);

module.exports = router;

