const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
    VIEW_ROLES,
    MUTATE_ROLES,
    listAccounts,
    getAccountById,
    createAccount,
    updateAccount,
    assignAccount,
    getDistributorWithDealers,
    getDealerWithLeadsAndCustomers,
    getAccountLeads,
    getAccountVisits,
    getAccountOrders,
    getAccountHierarchyTree,
    getDistributorAccounts,
} = require("../services/account.service");
const { getAccountTimeline, logActivity } = require("../services/activityLog.service");

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
router.use(allowRoles(...VIEW_ROLES));

router.get("/hierarchy/tree", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const tree = await getAccountHierarchyTree(companyId, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Account hierarchy fetched successfully", {
                tree,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/hierarchy/distributors", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const distributors = await getDistributorAccounts(companyId, req.query, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Distributor accounts fetched successfully", {
                distributors,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const accounts = await listAccounts(companyId, {
            ...req.query,
            currentUserId: req.user?._id,
        }, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Accounts fetched successfully", {
                accounts,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.post("/", allowRoles(...MUTATE_ROLES), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const account = await createAccount(companyId, req.body, req.user);

        return res.status(201).json(
            new ApiResponse(201, "Account created successfully", {
                account,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id/dealers", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const result = await getDistributorWithDealers(req.params.id, companyId, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Distributor dealers fetched successfully", result)
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id/leads", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const leads = await getAccountLeads(req.params.id, companyId, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Account leads fetched successfully", {
                leads,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id/visits", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const visits = await getAccountVisits(req.params.id, companyId, req.query, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Account visits fetched successfully", {
                visits,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id/orders", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const orders = await getAccountOrders(req.params.id, companyId, req.query, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Account orders fetched successfully", {
                orders,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id/timeline", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        await getAccountById(req.params.id, companyId, req.user);
        const result = await getAccountTimeline(req.params.id, companyId, req.query);

        return res.status(200).json(
            new ApiResponse(200, "Account timeline fetched successfully", result)
        );
    } catch (error) {
        next(error);
    }
});

router.post("/:id/log-activity", allowRoles(...MUTATE_ROLES), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        await getAccountById(req.params.id, companyId, req.user);
        const allowedTypes = ["call_logged", "whatsapp_logged", "note_added", "email_logged"];
        const activityType = req.body?.activityType || "note_added";
        if (!allowedTypes.includes(activityType)) {
            throw new ApiError(400, "Invalid activity type");
        }

        const activity = await logActivity({
            companyId,
            entityType: "account",
            entityId: req.params.id,
            activityType,
            performedBy: req.user._id,
            title: req.body?.title || "Account activity logged",
            description: req.body?.description || "",
            metadata: req.body?.metadata || {},
        });

        return res.status(201).json(
            new ApiResponse(201, "Account activity logged successfully", {
                activity,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id/dealer-summary", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const result = await getDealerWithLeadsAndCustomers(req.params.id, companyId, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Dealer hierarchy fetched successfully", result)
        );
    } catch (error) {
        next(error);
    }
});

router.get("/:id", async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const account = await getAccountById(req.params.id, companyId, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Account fetched successfully", {
                account,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.put("/:id", allowRoles(...MUTATE_ROLES), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const account = await updateAccount(req.params.id, companyId, req.body, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Account updated successfully", {
                account,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.patch("/:id/assign", allowRoles("company_admin", "sub_admin", "sales_head", "sales_manager"), async (req, res, next) => {
    try {
        const companyId = requireCompanyContext(req);
        const account = await assignAccount(req.params.id, companyId, req.body?.assignedTo, req.user);

        return res.status(200).json(
            new ApiResponse(200, "Customer assigned successfully", {
                account,
            })
        );
    } catch (error) {
        next(error);
    }
});

module.exports = router;
