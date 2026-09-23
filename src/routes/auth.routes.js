const express = require("express");
const {
    loginController,
    registerController,
    meController,
} = require("../controllers/auth.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");

const router = express.Router();

// Public
router.post("/login", loginController);

// Protected
router.get("/me", authenticate, meController);

// Only super_admin/company_admin can create users
router.post(
    "/register",
    authenticate,
    allowRoles("super_admin", "company_admin"),
    registerController
);

module.exports = router;

