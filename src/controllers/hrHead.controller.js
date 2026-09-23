const ApiResponse = require("../utils/ApiResponse");
const {
  getDashboard,
  getTeam,
  getDesignations,
  createDesignation,
  updateDesignation,
  getReports,
} = require("../services/hrHead.service");

const getHrHeadDashboardController = async (req, res, next) => {
  try {
    const data = await getDashboard({ user: req.user });
    return res.status(200).json(
      new ApiResponse(200, "HR Head dashboard fetched successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

const getHrHeadTeamController = async (req, res, next) => {
  try {
    const data = await getTeam({ user: req.user });
    return res.status(200).json(
      new ApiResponse(200, "HR department team fetched successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

const getHrHeadDesignationsController = async (req, res, next) => {
  try {
    const data = await getDesignations({ user: req.user });
    return res.status(200).json(
      new ApiResponse(200, "HR department designations fetched successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

const createHrHeadDesignationController = async (req, res, next) => {
  try {
    const data = await createDesignation({
      user: req.user,
      payload: req.body,
    });

    return res.status(201).json(
      new ApiResponse(201, "HR designation created successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

const updateHrHeadDesignationController = async (req, res, next) => {
  try {
    const data = await updateDesignation({
      user: req.user,
      designationId: req.params.designationId,
      payload: req.body,
    });

    return res.status(200).json(
      new ApiResponse(200, "HR designation updated successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

const getHrHeadReportsController = async (req, res, next) => {
  try {
    const data = await getReports({ user: req.user });
    return res.status(200).json(
      new ApiResponse(200, "HR Head reports fetched successfully", data)
    );
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHrHeadDashboardController,
  getHrHeadTeamController,
  getHrHeadDesignationsController,
  createHrHeadDesignationController,
  updateHrHeadDesignationController,
  getHrHeadReportsController,
};
