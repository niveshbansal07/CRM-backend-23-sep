const Product = require("../models/Product");
const ProductPriceHistory = require("../models/ProductPriceHistory");
const ApiError = require("../utils/ApiError");

const READ_ROLES = [
  "company_admin",
  "sub_admin",
  "sales_head",
  "sales_manager",
  "sales_executive",
  "sales",
  "hr_head",
  "hr_manager",
  "hr_general",
  "hr_executive",
];

const WRITE_ROLES = ["company_admin", "sub_admin"];

const productPopulate = [
  { path: "materialTypeId", select: "name code type module" },
  { path: "materialGroupId", select: "name code type module" },
  { path: "divisionId", select: "name code type module" },
  { path: "purchasingGroupId", select: "name code type module" },
  { path: "procurementTypeId", select: "name code type module" },
  { path: "mrpTypeId", select: "name code type module" },
  { path: "taxClassificationId", select: "name code type module metadata" },
  { path: "priceControlId", select: "name code type module" },
  { path: "countryOfOriginId", select: "name code type module" },
];

const assertCompanyId = (companyId) => {
  if (!companyId) throw new ApiError(400, "Company context is required");
};

const buildProductFilter = (companyId, filters = {}) => {
  assertCompanyId(companyId);
  const query = { companyId, deletedAt: null };

  if (filters.materialGroupId) query.materialGroupId = filters.materialGroupId;
  if (filters.divisionId) query.divisionId = filters.divisionId;
  if (filters.isActive !== undefined) {
    query.isActive = filters.isActive === true || filters.isActive === "true";
  }
  if (filters.search) {
    const search = String(filters.search).trim();
    query.$or = [
      { materialDescription: { $regex: search, $options: "i" } },
      { materialNumber: { $regex: search, $options: "i" } },
    ];
  }

  return query;
};

const listProducts = async (companyId, filters = {}) => {
  const query = buildProductFilter(companyId, filters);
  return Product.find(query).populate(productPopulate).sort({ materialDescription: 1 }).lean();
};

const lookupProducts = async (companyId, q = "") => {
  assertCompanyId(companyId);
  const search = String(q || "").trim();
  const query = { companyId, deletedAt: null, isActive: true };

  if (search) {
    query.$or = [
      { materialDescription: { $regex: search, $options: "i" } },
      { materialNumber: { $regex: search, $options: "i" } },
    ];
  }

  return Product.find(query)
    .select("materialNumber materialDescription baseUnitOfMeasure salesUnit standardPrice currency taxRate maxDiscountPercent stockQuantity images taxClassificationId")
    .populate({ path: "taxClassificationId", select: "name code metadata" })
    .sort({ materialDescription: 1 })
    .limit(25)
    .lean();
};

const getProductById = async (id, companyId) => {
  assertCompanyId(companyId);
  const product = await Product.findOne({ _id: id, companyId, deletedAt: null }).populate(productPopulate).lean();
  if (!product) throw new ApiError(404, "Product not found");
  return product;
};

const createProduct = async (companyId, data, userId = null) => {
  assertCompanyId(companyId);
  return Product.create({
    ...data,
    companyId,
    createdBy: userId,
    updatedBy: userId,
  });
};

const updateProduct = async (id, companyId, data, userId = null) => {
  assertCompanyId(companyId);
  const product = await Product.findOne({ _id: id, companyId, deletedAt: null });
  if (!product) throw new ApiError(404, "Product not found");

  const update = { ...data };
  const blockedFields = ["companyId", "createdBy", "createdAt", "deletedAt"];
  blockedFields.forEach((field) => delete update[field]);

  product.$locals.priceChangeReason = update.priceChangeReason || update.reason || "";
  delete update.priceChangeReason;
  delete update.reason;

  Object.keys(update).forEach((field) => {
    product[field] = update[field];
  });
  product.updatedBy = userId;

  await product.save();
  return Product.findById(product._id).populate(productPopulate);
};

const updateProductStatus = async (id, companyId, isActive, userId = null) => {
  assertCompanyId(companyId);
  const product = await Product.findOne({ _id: id, companyId, deletedAt: null });
  if (!product) throw new ApiError(404, "Product not found");

  product.isActive = Boolean(isActive);
  product.updatedBy = userId;
  await product.save();
  return product;
};

const getProductsByMaterialGroup = async (companyId, groupId) => {
  assertCompanyId(companyId);
  return Product.find({ companyId, materialGroupId: groupId, deletedAt: null, isActive: true })
    .populate(productPopulate)
    .sort({ materialDescription: 1 })
    .lean();
};

const getProductPriceHistory = async (companyId, productId) => {
  await getProductById(productId, companyId);
  return ProductPriceHistory.find({ companyId, productId })
    .populate({ path: "changedBy", select: "fullName email role" })
    .sort({ changedAt: -1 })
    .lean();
};

module.exports = {
  Product,
  ProductPriceHistory,
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
};
