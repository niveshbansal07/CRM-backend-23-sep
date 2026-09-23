const mongoose = require("mongoose");
const Order = require("../models/Order");
const OrderItem = require("../models/OrderItem");
const Product = require("../models/Product");
const Account = require("../models/Account");
const Lead = require("../models/Lead");
const Visit = require("../models/Visit");
const ApiError = require("../utils/ApiError");
const { getAccessRole } = require("../utils/roleAccess");
const {
  andFilters,
  resolveSalesVisibilityContext,
  resolveAccessibleAccountScope,
  buildOrderVisibilityFilter,
  buildLeadVisibilityFilter,
  buildVisitVisibilityFilter,
  assertEmployeeWithinVisibility,
  assertAccountWithinVisibility,
} = require("./salesVisibility.service");
const { recordOrderCreatedAchievement } = require("./salesAchievement.service");
const { writeAuditLog } = require("./auditLog.service");
const SalesAchievementCaptureFailure = require("../models/SalesAchievementCaptureFailure");

const READ_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];
const WRITE_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];

const orderPopulate = [
  { path: "accountId", select: "name accountType accountTypeId phone email" },
  { path: "assignedTo", select: "fullName email role" },
  { path: "orderStatus", select: "name code" },
  { path: "paymentStatus", select: "name code" },
];

const assertCompanyId = (companyId) => {
  if (!companyId) throw new ApiError(400, "Company context is required");
};

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const resolveTaxRate = (product) => {
  const master = product.taxClassificationId;
  const metadata = master?.metadata || {};
  return Number(metadata.taxRate ?? metadata.rate ?? product.taxRate ?? 0) || 0;
};

const buildOrderItemPayload = async ({ companyId, orderId, lineItem, userId }) => {
  const product = await Product.findOne({
    _id: lineItem.productId,
    companyId,
    deletedAt: null,
    isActive: true,
  }).populate("taxClassificationId");

  if (!product) throw new ApiError(404, "Product not found for order line item");

  const basePrice = Number(product.standardPrice) || 0;

  return {
    companyId,
    parentType: "order",
    parentId: orderId,
    productId: product._id,
    materialNumberSnapshot: product.materialNumber,
    productNameSnapshot: product.materialDescription,
    quantity: Number(lineItem.quantity) || 1,
    uom: product.baseUnitOfMeasure || product.salesUnit || "",
    basePriceSnapshot: basePrice,
    negotiatedUnitPrice: basePrice,
    discountTypeId: null,
    discountValue: 0,
    taxRate: resolveTaxRate(product),
    priceChangeReason: "",
    approvalStatus: "not_required",
    createdBy: userId,
    updatedBy: userId,
  };
};

const calculateOrderTotals = (items = []) => ({
  grandTotal: roundMoney(items.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0)),
  discountTotal: roundMoney(items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0)),
  taxTotal: roundMoney(items.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0)),
});

const createOrder = async (companyId, payload, user, req = null) => {
  assertCompanyId(companyId);
  if (!Array.isArray(payload.lineItems) || payload.lineItems.length === 0) {
    throw new ApiError(400, "At least one order line item is required");
  }

  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  await assertAccountWithinVisibility({ context: visibility, accountId: payload.accountId, companyId });
  if (payload.sourceLeadId) {
    const sourceLead = await Lead.findOne(andFilters(
      { _id: payload.sourceLeadId, companyId, deletedAt: null },
      buildLeadVisibilityFilter(visibility)
    )).select("_id").lean();
    if (!sourceLead) throw new ApiError(404, "Source Lead not found");
  }
  if (payload.sourceVisitId) {
    const sourceVisit = await Visit.findOne(andFilters(
      { _id: payload.sourceVisitId, companyId },
      buildVisitVisibilityFilter(visibility)
    )).select("_id").lean();
    if (!sourceVisit) throw new ApiError(404, "Source Visit not found");
  }
  const account = await Account.findOne({ _id: payload.accountId, companyId, deletedAt: null }).select("_id assignedTo");
  if (!account) throw new ApiError(404, "Account not found");
  const role = getAccessRole(user);
  let assignedTo = payload.assignedTo || account.assignedTo || user?._id || null;
  if (["sales_executive", "sales"].includes(role)) {
    assignedTo = user._id;
  } else if (assignedTo && String(assignedTo) !== String(user?._id)) {
    try {
      await assertEmployeeWithinVisibility({ context: visibility, employeeId: assignedTo, companyId });
    } catch (error) {
      if (payload.assignedTo) throw error;
      assignedTo = user?._id || null;
    }
  }

  const order = await Order.create({
    companyId,
    accountId: payload.accountId,
    contactId: payload.contactId || null,
    sourceLeadId: payload.sourceLeadId || null,
    sourceDealId: payload.sourceDealId || null,
    sourceVisitId: payload.sourceVisitId || null,
    assignedTo,
    orderStatus: payload.orderStatus || payload.orderStatusId || null,
    paymentStatus: payload.paymentStatus || payload.paymentStatusId || null,
    deliveryAddress: payload.deliveryAddress || "",
    deliveryDate: payload.deliveryDate || null,
    notes: payload.notes || "",
    createdBy: user?._id || null,
    updatedBy: user?._id || null,
  });

  try {
    const itemPayloads = [];
    for (const lineItem of payload.lineItems) {
      itemPayloads.push(await buildOrderItemPayload({
        companyId,
        orderId: order._id,
        lineItem,
        userId: user?._id || null,
      }));
    }

    const orderItems = await OrderItem.create(itemPayloads);
    const totals = calculateOrderTotals(orderItems);
    order.grandTotal = totals.grandTotal;
    order.discountTotal = totals.discountTotal;
    order.taxTotal = totals.taxTotal;
    await order.save();

    let achievement;
    try {
      achievement = await recordOrderCreatedAchievement({ companyId, order, orderItems, req });
    } catch (achievementError) {
      // Achievement capture must never roll back a successfully booked order.
      achievement = { status: "CAPTURE_FAILED" };
      const captureFailure = await SalesAchievementCaptureFailure.findOneAndUpdate(
        { companyId, orderId: order._id, sourceEvent: "ORDER_CREATED", sourceEventVersion: 1 },
        {
          $set: {
            status: "OPEN",
            resolvedAt: null,
            resolvedBy: null,
            errorCode: achievementError.code || "ACHIEVEMENT_CAPTURE_FAILED",
            errorSummary: String(achievementError.message || "Achievement capture failed").slice(0, 500),
            lastAttemptAt: new Date(),
          },
          $inc: { attemptCount: 1 },
          $setOnInsert: { companyId, orderId: order._id, operationId: new mongoose.Types.ObjectId(), sourceEvent: "ORDER_CREATED", sourceEventVersion: 1 },
        },
        { upsert: true, new: true, setDefaultsOnInsert: false }
      ).catch(() => null);
      await writeAuditLog({
        companyId,
        actorId: user?._id || null,
        action: "SALES_ACHIEVEMENT_CAPTURE_FAILED",
        entityType: "Order",
        entityId: order._id,
        metadata: { operationId: captureFailure?.operationId || null, sourceEntityId: order._id, errorCode: achievementError.code || "ACHIEVEMENT_CAPTURE_FAILED", errorName: achievementError.name || "Error", errorMessage: achievementError.message || "Achievement capture failed" },
        req,
      }).catch(() => null);
    }

    return { order, orderItems, approvalRequest: null, achievement };
  } catch (error) {
    await Order.deleteOne({ _id: order._id, companyId });
    throw error;
  }
};

const getOrderById = async (companyId, orderId, user = null) => {
  assertCompanyId(companyId);
  if (!mongoose.Types.ObjectId.isValid(String(orderId || ""))) {
    throw new ApiError(404, "Order not found");
  }
  let visibilityFilter = {};
  if (user) {
    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    const accountScope = await resolveAccessibleAccountScope(visibility);
    visibilityFilter = buildOrderVisibilityFilter(visibility, { accountIds: accountScope.accountIds });
  }
  const order = await Order.findOne(andFilters(
    { _id: orderId, companyId, deletedAt: null },
    visibilityFilter
  )).populate(orderPopulate).lean();
  if (!order) throw new ApiError(404, "Order not found");
  const orderItems = await OrderItem.find({ companyId, parentType: "order", parentId: orderId })
    .populate("productId", "materialNumber materialDescription")
    .populate("discountTypeId", "name code")
    .lean();
  return { order, orderItems };
};

const listOrders = async (companyId, filters = {}, user = null) => {
  assertCompanyId(companyId);
  let visibilityFilter = {};
  if (user) {
    const visibility = await resolveSalesVisibilityContext({ user, companyId });
    const accountScope = await resolveAccessibleAccountScope(visibility);
    visibilityFilter = buildOrderVisibilityFilter(visibility, {
      accountIds: accountScope.accountIds,
      assignedTo: filters.assignedTo,
    });
  }
  const query = andFilters({ companyId, deletedAt: null }, visibilityFilter);
  if (filters.accountId) query.accountId = filters.accountId;
  if (filters.assignedTo && !user) query.assignedTo = filters.assignedTo;
  if (filters.orderStatus) query.orderStatus = filters.orderStatus;
  if (filters.paymentStatus) query.paymentStatus = filters.paymentStatus;
  if (filters.dateFrom || filters.dateTo) {
    query.createdAt = {};
    if (filters.dateFrom) query.createdAt.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setDate(to.getDate() + 1);
      query.createdAt.$lt = to;
    }
  }

  return Order.find(query).populate(orderPopulate).sort({ createdAt: -1 }).lean();
};

module.exports = {
  Order,
  OrderItem,
  READ_ROLES,
  WRITE_ROLES,
  createOrder,
  getOrderById,
  listOrders,
};
