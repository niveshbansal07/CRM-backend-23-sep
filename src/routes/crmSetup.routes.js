const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
    LeadType,
    VisitType,
    ensureCompanyCrmTypes,
    getItems,
    getItemById,
    createItem,
    updateItem,
    updateItemStatus,
} = require("../services/crmSetup.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
    const companyId = getCompanyId(req.user);
    if (!companyId) {
        throw new ApiError(400, "Company context is required");
    }
    return companyId;
};

const setupCrudRoutes = (path, Model, label, responseKey) => {
    router.get(path, async (req, res, next) => {
        try {
            const companyId = requireCompanyContext(req);
            await ensureCompanyCrmTypes(companyId, req.user?._id || null);
            const items = await getItems(Model, companyId, req.query);

            return res.status(200).json(
                new ApiResponse(200, `${label}s fetched successfully`, {
                    [responseKey]: items,
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.post(path, allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
        try {
            const companyId = requireCompanyContext(req);
            const item = await createItem(Model, companyId, req.body, req.user?._id || null, label);

            return res.status(201).json(
                new ApiResponse(201, `${label} created successfully`, {
                    [responseKey.slice(0, -1)]: item,
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.get(`${path}/:id`, async (req, res, next) => {
        try {
            const companyId = requireCompanyContext(req);
            const item = await getItemById(Model, companyId, req.params.id, label);

            return res.status(200).json(
                new ApiResponse(200, `${label} fetched successfully`, {
                    [responseKey.slice(0, -1)]: item,
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.put(`${path}/:id`, allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
        try {
            const companyId = requireCompanyContext(req);
            const item = await updateItem(Model, companyId, req.params.id, req.body, req.user?._id || null, label);

            return res.status(200).json(
                new ApiResponse(200, `${label} updated successfully`, {
                    [responseKey.slice(0, -1)]: item,
                })
            );
        } catch (error) {
            next(error);
        }
    });

    router.patch(`${path}/:id/status`, allowRoles("company_admin", "sub_admin"), async (req, res, next) => {
        try {
            const companyId = requireCompanyContext(req);
            const item = await updateItemStatus(
                Model,
                companyId,
                req.params.id,
                req.body?.isActive,
                req.user?._id || null,
                label
            );

            return res.status(200).json(
                new ApiResponse(200, `${label} status updated successfully`, {
                    [responseKey.slice(0, -1)]: item,
                })
            );
        } catch (error) {
            next(error);
        }
    });
};

router.use(authenticate);

setupCrudRoutes("/lead-types", LeadType, "Lead type", "leadTypes");
setupCrudRoutes("/visit-types", VisitType, "Visit type", "visitTypes");

module.exports = router;
