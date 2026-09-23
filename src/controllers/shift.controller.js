const ApiResponse = require("../utils/ApiResponse");
const {
  listShifts,
  createShift,
  updateShift,
  softDeleteShift,
  assignShift,
} = require("../services/shift.service");

const listShiftsController = async (req, res, next) => {
  try {
    const shifts = await listShifts({ user: req.user });
    res.status(200).json(new ApiResponse(200, "Shifts fetched successfully", { shifts }));
  } catch (error) {
    next(error);
  }
};

const createShiftController = async (req, res, next) => {
  try {
    const shift = await createShift({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Shift created successfully", { shift }));
  } catch (error) {
    next(error);
  }
};

const updateShiftController = async (req, res, next) => {
  try {
    const shift = await updateShift({
      user: req.user,
      shiftId: req.params.id,
      payload: req.validatedBody,
      req,
    });
    res.status(200).json(new ApiResponse(200, "Shift updated successfully", { shift }));
  } catch (error) {
    next(error);
  }
};

const deleteShiftController = async (req, res, next) => {
  try {
    await softDeleteShift({ user: req.user, shiftId: req.params.id, req });
    res.status(200).json(new ApiResponse(200, "Shift deleted successfully", null));
  } catch (error) {
    next(error);
  }
};

const assignShiftController = async (req, res, next) => {
  try {
    const assignment = await assignShift({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Shift assigned successfully", { assignment }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listShiftsController,
  createShiftController,
  updateShiftController,
  deleteShiftController,
  assignShiftController,
};
