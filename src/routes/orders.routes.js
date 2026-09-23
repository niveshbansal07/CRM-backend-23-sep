const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  READ_ROLES,
  WRITE_ROLES,
  createOrder,
  getOrderById,
  listOrders,
} = require("../services/order.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
  const companyId = getCompanyId(req.user);
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

router.use(authenticate);
router.use(allowRoles(...READ_ROLES));

router.get("/my", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const orders = await listOrders(companyId, { ...req.query, assignedTo: req.user._id }, req.user);
    return res.status(200).json(new ApiResponse(200, "My orders fetched successfully", { orders }));
  } catch (error) {
    next(error);
  }
});

router.get("/team", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const orders = await listOrders(companyId, req.query, req.user);
    return res.status(200).json(new ApiResponse(200, "Team orders fetched successfully", { orders }));
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const orders = await listOrders(companyId, req.query, req.user);
    return res.status(200).json(new ApiResponse(200, "Orders fetched successfully", { orders }));
  } catch (error) {
    next(error);
  }
});

router.post("/", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const result = await createOrder(companyId, req.body, req.user, req);
    return res.status(201).json(new ApiResponse(201, "Order created successfully", result));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const result = await getOrderById(companyId, req.params.id, req.user);
    return res.status(200).json(new ApiResponse(200, "Order fetched successfully", result));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
