const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const { REQUEST_STATUSES } = require("../constants/distributorReassignment");

const objectId = (value, label) => {
  if (!mongoose.Types.ObjectId.isValid(String(value || ""))) {
    throw new ApiError(400, `${label} must be a valid ObjectId`);
  }
};

const rejectUnknown = (payload, allowed) => {
  const unknown = Object.keys(payload || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ApiError(400, `Unsupported reassignment fields: ${unknown.join(", ")}`);
};

const reason = (value, label) => {
  if (typeof value !== "string" || value.trim().length < 2) throw new ApiError(400, `${label} is required`);
  if (value.trim().length > 500) throw new ApiError(400, `${label} must be 500 characters or less`);
  return value.trim().replace(/\s+/g, " ");
};

const validateIntent = (req, _res, next) => {
  try {
    rejectUnknown(req.body, ["distributorAccountId", "destinationAreaId", "newPrimaryFsdId", "reason"]);
    objectId(req.body?.distributorAccountId, "Distributor Account");
    objectId(req.body?.newPrimaryFsdId, "New Primary FSD");
    if (req.body?.destinationAreaId !== undefined) objectId(req.body.destinationAreaId, "Destination Area");
    req.body = {
      distributorAccountId: req.body.distributorAccountId,
      newPrimaryFsdId: req.body.newPrimaryFsdId,
      ...(req.body.destinationAreaId !== undefined ? { destinationAreaId: req.body.destinationAreaId } : {}),
      reason: reason(req.body.reason, "Reassignment reason"),
    };
    next();
  } catch (error) { next(error); }
};

const requireTransferDestination = (req, _res, next) => {
  try {
    if (!req.body?.destinationAreaId) throw new ApiError(400, "Destination Area is required for transfer preview");
    next();
  } catch (error) { next(error); }
};

const validateDecision = (req, _res, next) => {
  try {
    rejectUnknown(req.body, ["decisionReason", "override", "overrideReason"]);
    if (req.body?.override !== undefined && typeof req.body.override !== "boolean") {
      throw new ApiError(400, "override must be a boolean");
    }
    req.body = {
      decisionReason: reason(req.body?.decisionReason, "Decision reason"),
      override: req.body?.override === true,
      ...(req.body?.overrideReason !== undefined
        ? { overrideReason: reason(req.body.overrideReason, "Override reason") }
        : {}),
    };
    next();
  } catch (error) { next(error); }
};

const validateRequestId = (req, _res, next) => {
  try { objectId(req.params.requestId, "Reassignment request"); next(); } catch (error) { next(error); }
};

const validateAccountId = (req, _res, next) => {
  try { objectId(req.params.accountId, "Distributor Account"); next(); } catch (error) { next(error); }
};

const validateAreaId = (req, _res, next) => {
  try { objectId(req.params.areaId, "Destination Area"); next(); } catch (error) { next(error); }
};

const validateListQuery = (req, _res, next) => {
  try {
    if (req.query.status && !Object.values(REQUEST_STATUSES).includes(req.query.status)) {
      throw new ApiError(400, "Unsupported reassignment request status");
    }
    if (req.query.distributorAccountId) objectId(req.query.distributorAccountId, "Distributor Account");
    next();
  } catch (error) { next(error); }
};

module.exports = {
  validateIntent,
  requireTransferDestination,
  validateDecision,
  validateRequestId,
  validateAccountId,
  validateAreaId,
  validateListQuery,
};
