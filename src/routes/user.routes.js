const express = require("express");
const {
    getUsersController,
    getUserByIdController,
    updateUserController,
    deleteUserController,
    createCompanyStaffController,
    createHrDepartmentEmployeeController,
    updateHrDepartmentEmployeeController,
    setupEmployeeFromRequestController,
} = require("../controllers/user.controller");

const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles, allowCompanyAdmin } = require("../middlewares/role.middleware");

const router = express.Router();

router.use(authenticate);

router.post(
    "/company-staff",
    allowCompanyAdmin,
    createCompanyStaffController
);

router.post(
    "/setup-employee",
    allowRoles("hr_head", "hr_executive"),
    setupEmployeeFromRequestController
);

router.post(
    "/hr-department-employee",
    allowRoles("hr_head"),
    createHrDepartmentEmployeeController
);

router.post(
    "/hr-direct-employee",
    allowRoles("hr_head"),
    createHrDepartmentEmployeeController
);

router.patch(
    "/hr-department-employee/:id",
    allowRoles("hr_head"),
    updateHrDepartmentEmployeeController
);

router.get(
    "/",
    allowRoles("super_admin", "company_admin", "sub_admin", "hr_head", "hr_manager", "hr_general", "hr_executive"),
    getUsersController
);

router.get(
    "/:id",
    allowRoles("super_admin", "company_admin", "sub_admin", "hr_head", "hr_manager", "hr_general", "hr_executive"),
    getUserByIdController
);

router.patch(
    "/:id",
    allowRoles("super_admin", "company_admin", "sub_admin"),
    updateUserController
);

router.delete(
    "/:id",
    allowRoles("super_admin", "company_admin", "sub_admin"),
    deleteUserController
);

module.exports = router;
