const ApiResponse = require("../utils/ApiResponse");
const {
  getHrSetupStatus,
  createHrHead,
} = require("../services/hrSetup.service");

const getHrSetupStatusController = async (req, res, next) => {
  try {
    const data = await getHrSetupStatus({ user: req.user });

    return res.status(200).json(
      new ApiResponse(200, "HR setup status fetched successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

const createHrHeadController = async (req, res, next) => {
  try {
    const data = await createHrHead({
      payload: req.body,
      user: req.user,
    });

    return res.status(201).json(
      new ApiResponse(201, "HR Head created successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHrSetupStatusController,
  createHrHeadController,
};
