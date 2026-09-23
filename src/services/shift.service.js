const User = require("../models/User");
const Shift = require("../models/Shift");
const EmployeeShiftAssignment = require("../models/EmployeeShiftAssignment");
const ApiError = require("../utils/ApiError");
const { EMPLOYEE_ACCOUNT_ROLES } = require("../utils/employeeRole");
const { startOfDay } = require("../utils/dateTime");
const { assertCompanyScopedUser, getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");

const listShifts = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);
  return Shift.find({ companyId, deletedAt: null }).sort({ isActive: -1, name: 1 });
};

const createShift = async ({ user, payload, req }) => {
  const companyId = assertCompanyScopedUser(user);
  const shift = await Shift.create({
    ...payload,
    companyId,
    createdBy: user._id,
    updatedBy: user._id,
  });

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "shift_created",
    entityType: "Shift",
    entityId: shift._id,
    req,
  });

  return shift;
};

const updateShift = async ({ user, shiftId, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const shift = await Shift.findOne({ _id: shiftId, companyId, deletedAt: null });

  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value !== undefined) shift[key] = value;
  });
  shift.updatedBy = user._id;
  await shift.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "shift_updated",
    entityType: "Shift",
    entityId: shift._id,
    req,
  });

  return shift;
};

const softDeleteShift = async ({ user, shiftId, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const shift = await Shift.findOne({ _id: shiftId, companyId, deletedAt: null });

  if (!shift) {
    throw new ApiError(404, "Shift not found");
  }

  shift.deletedAt = new Date();
  shift.isActive = false;
  shift.updatedBy = user._id;
  await shift.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "shift_deleted",
    entityType: "Shift",
    entityId: shift._id,
    req,
  });

  return shift;
};

const assignShift = async ({ user, payload, req }) => {
  const companyId = assertCompanyScopedUser(user);

  const [employee, shift] = await Promise.all([
    User.findOne({ _id: payload.employeeId, companyId, deletedAt: null }).select("_id companyId status role fullName"),
    Shift.findOne({ _id: payload.shiftId, companyId, deletedAt: null, isActive: true }),
  ]);

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  if (!EMPLOYEE_ACCOUNT_ROLES.includes(employee.role)) {
    throw new ApiError(400, "Selected user cannot receive an employee shift");
  }

  if (!shift) {
    throw new ApiError(404, "Active shift not found");
  }

  const effectiveFrom = startOfDay(payload.effectiveFrom);
  await EmployeeShiftAssignment.updateMany(
    {
      companyId,
      employeeId: employee._id,
      isActive: true,
      deletedAt: null,
    },
    {
      $set: {
        isActive: false,
        effectiveTo: effectiveFrom,
        updatedBy: user._id,
      },
    }
  );

  const assignment = await EmployeeShiftAssignment.create({
    companyId,
    employeeId: employee._id,
    shiftId: shift._id,
    effectiveFrom,
    effectiveTo: payload.effectiveTo || null,
    assignedBy: user._id,
    updatedBy: user._id,
  });

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "employee_shift_assigned",
    entityType: "EmployeeShiftAssignment",
    entityId: assignment._id,
    metadata: { employeeId: employee._id, shiftId: shift._id },
    req,
  });

  return assignment.populate([
    { path: "employeeId", select: "fullName email employeeId role" },
    { path: "shiftId", select: "name startTime endTime" },
  ]);
};

const getEmployeeActiveShift = async ({ companyId, employeeId, date, session = null }) => {
  const targetDate = startOfDay(date || new Date());
  const query = EmployeeShiftAssignment.findOne({
    companyId,
    employeeId,
    effectiveFrom: { $lte: targetDate },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: targetDate } }],
    isActive: true,
    deletedAt: null,
  })
    .sort({ effectiveFrom: -1 })
    .populate("shiftId");

  if (session) query.session(session);

  const assignment = await query;
  return assignment?.shiftId || null;
};

module.exports = {
  listShifts,
  createShift,
  updateShift,
  softDeleteShift,
  assignShift,
  getEmployeeActiveShift,
};
