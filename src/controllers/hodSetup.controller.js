const ApiResponse = require("../utils/ApiResponse");
const {
  listDepartmentHodStatuses,
  createDepartmentHod,
} = require("../services/hodSetup.service");

const listDepartmentHodStatusesController = async (req, res, next) => {
  try {
    const data = await listDepartmentHodStatuses({ user: req.user });
    return res
      .status(200)
      .json(new ApiResponse(200, "Department HOD setup status fetched successfully", data));
  } catch (error) {
    return next(error);
  }
};

const createDepartmentHodController = async (req, res, next) => {
  try {
    const data = await createDepartmentHod({
      departmentId: req.params.departmentId,
      payload: req.validatedBody,
      user: req.user,
      req,
    });
    return res
      .status(201)
      .json(new ApiResponse(201, "Department HOD created successfully", data));
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  listDepartmentHodStatusesController,
  createDepartmentHodController,
};
