const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
    ensureCompanyMasters,
    getMasters,
    getMasterTypes,
    createMaster,
    updateMaster,
    deactivateMaster,
    deleteMaster,
} = require("../services/crmMaster.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
    const companyId = getCompanyId(req.user);
    if (!companyId) {
        throw new ApiError(400, "Company context is required");
    }
    return companyId;
};

router.use(authenticate);

router.get("/", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        await ensureCompanyMasters(companyId, req.user?._id || null);
        const masters = await getMasters(companyId, req.query);

        return res.status(200).json(
            new ApiResponse(200, "CRM masters fetched successfully", {
                masters,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/types", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        await ensureCompanyMasters(companyId, req.user?._id || null);
        const types = await getMasterTypes(companyId);

        return res.status(200).json(
            new ApiResponse(200, "CRM master types fetched successfully", {
                types,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.post("/", allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const master = await createMaster(companyId, req.body, req.user?._id || null);

        return res.status(201).json(
            new ApiResponse(201, "CRM master created successfully", {
                master,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.put("/:id", allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const master = await updateMaster(req.params.id, companyId, req.body, req.user?._id || null);

        return res.status(200).json(
            new ApiResponse(200, "CRM master updated successfully", {
                master,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/status", allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const master = await deactivateMaster(
            req.params.id,
            companyId,
            req.body?.isActive,
            req.user?._id || null
        );

        return res.status(200).json(
            new ApiResponse(200, "CRM master status updated successfully", {
                master,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.delete("/:id", allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const result = await deleteMaster(req.params.id, companyId);

        return res.status(200).json(
            new ApiResponse(200, result.deleted ? "CRM master deleted successfully" : "CRM master is in use", result)
        );
    } catch (error) {
        next(error);
    }
});

module.exports = router;
