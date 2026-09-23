const ApiResponse = require("../utils/ApiResponse");
const {
  listDistributorMappingReadiness,
  getDistributorMappingDetails,
  listEligiblePrimaryFsds,
  buildInitialDistributorMappingPreview,
  applyInitialDistributorMapping,
} = require("../services/distributorSalesMapping.service");

const readinessController = async (req, res, next) => {
  try {
    const result = await listDistributorMappingReadiness({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Distributor mapping readiness fetched successfully", result));
  } catch (error) {
    next(error);
  }
};

const detailsController = async (req, res, next) => {
  try {
    const result = await getDistributorMappingDetails({ accountId: req.params.accountId, user: req.user });
    res.status(200).json(new ApiResponse(200, "Distributor Sales mapping fetched successfully", result));
  } catch (error) {
    next(error);
  }
};

const eligibleFsdsController = async (req, res, next) => {
  try {
    const fsds = await listEligiblePrimaryFsds({ areaId: req.params.areaId, user: req.user });
    res.status(200).json(new ApiResponse(200, "Eligible Primary FSDs fetched successfully", { fsds }));
  } catch (error) {
    next(error);
  }
};

const previewController = async (req, res, next) => {
  try {
    const preview = await buildInitialDistributorMappingPreview({ payload: req.body, user: req.user });
    res.status(200).json(new ApiResponse(200, "Initial Distributor mapping preview generated", { preview }));
  } catch (error) {
    next(error);
  }
};

const applyController = async (req, res, next) => {
  try {
    const result = await applyInitialDistributorMapping({ payload: req.body, user: req.user, req });
    res.status(201).json(new ApiResponse(201, "Initial Distributor Sales mapping created", result));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  readinessController,
  detailsController,
  eligibleFsdsController,
  previewController,
  applyController,
};
