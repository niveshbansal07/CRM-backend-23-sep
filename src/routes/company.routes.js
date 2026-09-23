const express = require("express");
const router = express.Router();

const {
    createCompanyController,
    getCompaniesController,
    updateCompanyController,
    deleteCompanyController,
} = require("../controllers/company.controller");

const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");

router.get("/", authenticate, allowRoles("super_admin"), getCompaniesController);
router.post("/", authenticate, allowRoles("super_admin"), createCompanyController);
router.patch("/:id", authenticate, allowRoles("super_admin"), updateCompanyController);
router.delete("/:id", authenticate, allowRoles("super_admin"), deleteCompanyController);

module.exports = router;

