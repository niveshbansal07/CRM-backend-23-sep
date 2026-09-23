const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");

const objectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) throw new ApiError(400, `${label} must be a valid ObjectId`);
};

const reason = (value) => {
  if (typeof value !== "string" || value.trim().length < 2) throw new ApiError(400, "Channel mapping reason is required");
  if (value.trim().length > 500) throw new ApiError(400, "Channel mapping reason must be 500 characters or less");
  return value.trim().replace(/\s+/g, " ");
};

const validateMappingIntent = (req, _res, next) => {
  try {
    const payload = req.body || {};
    const customerIntent = payload.customerAccountId !== undefined || payload.parentAccountId !== undefined;
    const allowed = customerIntent
      ? ["customerAccountId", "parentAccountId", "reason"]
      : ["childAccountId", "distributorAccountId", "reason"];
    const unknown = Object.keys(payload).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new ApiError(400, `Unsupported channel mapping fields: ${unknown.join(", ")}`);
    if (customerIntent) {
      objectId(payload.customerAccountId, "Customer Account");
      objectId(payload.parentAccountId, "Dealer/Retailer parent Account");
      req.body = {
        customerAccountId: payload.customerAccountId,
        parentAccountId: payload.parentAccountId,
        reason: reason(payload.reason),
      };
    } else {
      objectId(payload.childAccountId, "Dealer/Retailer Account");
      objectId(payload.distributorAccountId, "Distributor Account");
      req.body = {
        childAccountId: payload.childAccountId,
        distributorAccountId: payload.distributorAccountId,
        reason: reason(payload.reason),
      };
    }
    next();
  } catch (error) { next(error); }
};

const validateAccountId = (req, _res, next) => {
  try {
    objectId(req.params.accountId || req.params.distributorAccountId, "Channel Account");
    next();
  } catch (error) { next(error); }
};

module.exports = { validateMappingIntent, validateAccountId };
