const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");

const objectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new ApiError(400, `${label} must be a valid ObjectId`);
  }
};

const rejectUnknown = (payload, allowed) => {
  const unknown = Object.keys(payload || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ApiError(400, `Unsupported Distributor mapping fields: ${unknown.join(", ")}`);
};

const validateInitialMapping = (req, _res, next) => {
  try {
    rejectUnknown(req.body, ["accountId", "areaId", "primaryFsdId", "reason", "activateAfterMapping"]);
    objectId(req.body?.accountId, "Distributor Account");
    objectId(req.body?.areaId, "Area");
    objectId(req.body?.primaryFsdId, "Primary FSD");
    if (typeof req.body?.reason !== "string" || req.body.reason.trim().length < 2) {
      throw new ApiError(400, "An initial mapping reason is required");
    }
    if (req.body.reason.trim().length > 500) throw new ApiError(400, "Mapping reason must be 500 characters or less");
    if (req.body.activateAfterMapping !== undefined && typeof req.body.activateAfterMapping !== "boolean") {
      throw new ApiError(400, "activateAfterMapping must be a boolean");
    }
    req.body = {
      accountId: req.body.accountId,
      areaId: req.body.areaId,
      primaryFsdId: req.body.primaryFsdId,
      reason: req.body.reason.trim().replace(/\s+/g, " "),
      activateAfterMapping: req.body.activateAfterMapping === true,
    };
    next();
  } catch (error) {
    next(error);
  }
};

const validateAccountId = (req, _res, next) => {
  try {
    objectId(req.params.accountId, "Distributor Account");
    next();
  } catch (error) {
    next(error);
  }
};

const validateAreaId = (req, _res, next) => {
  try {
    objectId(req.params.areaId, "Area");
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  validateInitialMapping,
  validateAccountId,
  validateAreaId,
};
