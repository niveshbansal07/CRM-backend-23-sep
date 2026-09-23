const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  READ_ROLES,
  WRITE_ROLES,
  listProducts,
  lookupProducts,
  getProductById,
  createProduct,
  updateProduct,
  updateProductStatus,
  getProductsByMaterialGroup,
  getProductPriceHistory,
} = require("../services/product.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
  const companyId = getCompanyId(req.user);
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

router.use(authenticate);
router.use(allowRoles(...READ_ROLES));

router.get("/", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const products = await listProducts(companyId, req.query);
    return res.status(200).json(new ApiResponse(200, "Products fetched successfully", { products }));
  } catch (error) {
    next(error);
  }
});

router.post("/", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const product = await createProduct(companyId, req.body, req.user?._id || null);
    return res.status(201).json(new ApiResponse(201, "Product created successfully", { product }));
  } catch (error) {
    next(error);
  }
});

router.get("/lookup", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const products = await lookupProducts(companyId, req.query.q);
    return res.status(200).json(new ApiResponse(200, "Product lookup fetched successfully", { products }));
  } catch (error) {
    next(error);
  }
});

router.get("/by-material-group/:groupId", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const products = await getProductsByMaterialGroup(companyId, req.params.groupId);
    return res.status(200).json(new ApiResponse(200, "Products by material group fetched successfully", { products }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/price-history", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const history = await getProductPriceHistory(companyId, req.params.id);
    return res.status(200).json(new ApiResponse(200, "Product price history fetched successfully", { history }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const product = await getProductById(req.params.id, companyId);
    return res.status(200).json(new ApiResponse(200, "Product fetched successfully", { product }));
  } catch (error) {
    next(error);
  }
});

router.put("/:id", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const product = await updateProduct(req.params.id, companyId, req.body, req.user?._id || null);
    return res.status(200).json(new ApiResponse(200, "Product updated successfully", { product }));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/status", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const product = await updateProductStatus(req.params.id, companyId, req.body?.isActive, req.user?._id || null);
    return res.status(200).json(new ApiResponse(200, "Product status updated successfully", { product }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
