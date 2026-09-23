const ApiResponse = require("../utils/ApiResponse");
const {
  listChannelReadiness,
  buildChannelMappingPreview,
  applyChannelMapping,
  getChannelHierarchy,
  getDistributorChannelAccounts,
} = require("../services/channelMapping.service");
const { CHANNEL_ACCOUNT_TYPES } = require("../constants/channelMapping");

const action = (handler, statusCode, message) => async (req, res, next) => {
  try {
    const result = await handler({
      payload: req.body,
      user: req.user,
      req,
      accountId: req.params.accountId,
      distributorAccountId: req.params.distributorAccountId,
    });
    res.status(statusCode).json(new ApiResponse(statusCode, message, result));
  } catch (error) { next(error); }
};

module.exports = {
  readinessController: action(listChannelReadiness, 200, "Channel mapping readiness fetched successfully"),
  previewController: action(buildChannelMappingPreview, 200, "Channel mapping preview generated"),
  applyController: action(applyChannelMapping, 200, "Channel mapping applied successfully"),
  dealerHierarchyController: action((input) => getChannelHierarchy({ ...input, expectedType: CHANNEL_ACCOUNT_TYPES.DEALER }), 200, "Dealer hierarchy fetched successfully"),
  retailerHierarchyController: action((input) => getChannelHierarchy({ ...input, expectedType: CHANNEL_ACCOUNT_TYPES.RETAILER }), 200, "Retailer hierarchy fetched successfully"),
  customerHierarchyController: action((input) => getChannelHierarchy({ ...input, expectedType: CHANNEL_ACCOUNT_TYPES.CUSTOMER }), 200, "Customer hierarchy fetched successfully"),
  distributorAccountsController: action(getDistributorChannelAccounts, 200, "Distributor channel Accounts fetched successfully"),
};
