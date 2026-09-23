const mongoose = require("mongoose");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const LeaveType = require("../models/LeaveType");
const LeaveBalance = require("../models/LeaveBalance");
const LeaveRequest = require("../models/LeaveRequest");
const ApiError = require("../utils/ApiError");
const { startOfDay, parseMonthParam } = require("../utils/dateTime");
const { getCompanyIdOrThrow, assertCompanyScopedUser } = require("./tenant.service");
const {
  calculateLeaveDays,
  blockPendingLeave,
  approveLeaveDeduction,
  rejectLeaveRestore,
  cancelLeaveRestore,
} = require("./leaveBalance.service");
const { processEmployeeAttendance } = require("./attendanceProcessor.service");
const { writeAuditLog } = require("./auditLog.service");

const getApproverForEmployee = async ({ employee, companyId }) => {
  if (employee.managerId) {
    const manager = await User.findOne({
      _id: employee.managerId,
      companyId,
      role: { $in: ["hr_head", "hr_manager", "company_admin", "sub_admin"] },
      status: "active",
      deletedAt: null,
    }).select("_id");
    if (manager) return manager._id;
  }

  const fallback = await User.findOne({
    companyId,
    role: ["hr_head", "hr_manager"].includes(employee.role) ? { $in: ["company_admin", "sub_admin"] } : { $in: ["hr_head", "hr_manager"] },
    status: "active",
    deletedAt: null,
  }).select("_id");

  return fallback?._id || null;
};

const isLeaveApplicable = (leaveType, employee) => {
  const applicable = leaveType.applicableFor || {};
  const departments = applicable.departments || [];
  const roles = applicable.roles || [];

  if (departments.length && !departments.includes(employee.department)) return false;
  if (roles.length && !roles.includes(employee.role)) return false;
  return true;
};

const listLeaveTypes = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);
  return LeaveType.find({ companyId, deletedAt: null }).sort({ isActive: -1, name: 1 });
};

const createLeaveType = async ({ user, payload, req }) => {
  const companyId = assertCompanyScopedUser(user);
  const leaveType = await LeaveType.create({
    ...payload,
    companyId,
    createdBy: user._id,
    updatedBy: user._id,
  });

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "leave_type_created",
    entityType: "LeaveType",
    entityId: leaveType._id,
    req,
  });

  return leaveType;
};

const updateLeaveType = async ({ user, leaveTypeId, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const leaveType = await LeaveType.findOne({ _id: leaveTypeId, companyId, deletedAt: null });

  if (!leaveType) {
    throw new ApiError(404, "Leave type not found");
  }

  Object.assign(leaveType, payload, { updatedBy: user._id });
  await leaveType.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "leave_type_updated",
    entityType: "LeaveType",
    entityId: leaveType._id,
    req,
  });

  return leaveType;
};

const softDeleteLeaveType = async ({ user, leaveTypeId, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const leaveType = await LeaveType.findOne({ _id: leaveTypeId, companyId, deletedAt: null });

  if (!leaveType) {
    throw new ApiError(404, "Leave type not found");
  }

  leaveType.deletedAt = new Date();
  leaveType.isActive = false;
  leaveType.updatedBy = user._id;
  await leaveType.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "leave_type_deleted",
    entityType: "LeaveType",
    entityId: leaveType._id,
    req,
  });

  return leaveType;
};

const getMyLeaveBalance = async ({ user, year }) => {
  const companyId = getCompanyIdOrThrow(user);
  const targetYear = Number(year || new Date().getFullYear());
  const leaveTypes = await LeaveType.find({ companyId, isActive: true, deletedAt: null }).sort({ name: 1 });
  const balances = [];

  for (const leaveType of leaveTypes) {
    let balance = await LeaveBalance.findOne({
      companyId,
      employeeId: user._id,
      leaveTypeId: leaveType._id,
      year: targetYear,
    });

    if (!balance) {
      balance = await LeaveBalance.create({
        companyId,
        employeeId: user._id,
        leaveTypeId: leaveType._id,
        year: targetYear,
        credited: leaveType.yearlyQuota || leaveType.accrualValue || 0,
        available: leaveType.yearlyQuota || leaveType.accrualValue || 0,
      });
    }

    balances.push({ leaveType, balance });
  }

  return balances;
};

const applyLeave = async ({ user, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const employee = await User.findOne({ _id: user._id, companyId, status: "active", deletedAt: null });

  if (!employee) {
    throw new ApiError(403, "Only active employees can apply leave");
  }

  const leaveType = await LeaveType.findOne({
    _id: payload.leaveTypeId,
    companyId,
    isActive: true,
    deletedAt: null,
  });

  if (!leaveType) {
    throw new ApiError(404, "Leave type not found");
  }

  if (!isLeaveApplicable(leaveType, employee)) {
    throw new ApiError(403, "This leave type is not applicable to you");
  }

  if (payload.durationType === "HALF_DAY" && !leaveType.allowHalfDay) {
    throw new ApiError(400, "Half-day leave is not allowed for this leave type");
  }

  const { totalDays, chargeableDates } = await calculateLeaveDays({
    companyId,
    fromDate: payload.fromDate,
    toDate: payload.toDate,
    durationType: payload.durationType,
  });

  if (totalDays <= 0) {
    throw new ApiError(400, "Selected dates do not contain chargeable working days");
  }

  if (leaveType.requiresAttachmentAfterDays && totalDays > leaveType.requiresAttachmentAfterDays && !payload.attachmentUrl) {
    throw new ApiError(400, "Attachment is required for this leave duration");
  }

  const overlap = await LeaveRequest.findOne({
    companyId,
    employeeId: user._id,
    status: { $in: ["PENDING", "APPROVED", "CANCEL_REQUESTED"] },
    fromDate: { $lte: startOfDay(payload.toDate) },
    toDate: { $gte: startOfDay(payload.fromDate) },
    deletedAt: null,
  });

  if (overlap) {
    throw new ApiError(409, "Leave request already exists for this date range");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const approverId = await getApproverForEmployee({ employee, companyId });
    await blockPendingLeave({
      companyId,
      employeeId: user._id,
      leaveType,
      year: startOfDay(payload.fromDate).getFullYear(),
      totalDays,
      actorId: user._id,
      session,
    });

    const [leaveRequest] = await LeaveRequest.create(
      [
        {
          companyId,
          employeeId: user._id,
          leaveTypeId: leaveType._id,
          fromDate: startOfDay(payload.fromDate),
          toDate: startOfDay(payload.toDate),
          durationType: payload.durationType,
          halfDayPart: payload.halfDayPart,
          totalDays,
          reason: payload.reason,
          attachmentUrl: payload.attachmentUrl,
          currentApproverId: approverId,
          createdBy: user._id,
          updatedBy: user._id,
          approvalHistory: [
            {
              action: "APPLIED",
              actorId: user._id,
              comment: payload.reason,
              actedAt: new Date(),
            },
          ],
          chargeableDates,
        },
      ],
      { session }
    );

    await writeAuditLog({
      companyId,
      actorId: user._id,
      action: "leave_applied",
      entityType: "LeaveRequest",
      entityId: leaveRequest._id,
      metadata: { totalDays },
      req,
      session,
    });

    await session.commitTransaction();
    return leaveRequest.populate([
      { path: "leaveTypeId", select: "name code paid" },
      { path: "currentApproverId", select: "fullName email role" },
    ]);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getMyLeaveRequests = async ({ user }) => {
  const companyId = getCompanyIdOrThrow(user);
  return LeaveRequest.find({ companyId, employeeId: user._id, deletedAt: null })
    .populate("leaveTypeId", "name code paid")
    .populate("approvedBy rejectedBy currentApproverId", "fullName email role")
    .sort({ createdAt: -1 });
};

const getPendingLeaveApprovals = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);
  return LeaveRequest.find({ companyId, status: "PENDING", deletedAt: null })
    .populate("employeeId", "fullName email employeeId department designation role")
    .populate("leaveTypeId", "name code paid")
    .sort({ createdAt: 1 });
};

const updateAttendanceForApprovedLeave = async ({ leaveRequest, employee, session }) => {
  const dates = await calculateLeaveDays({
    companyId: leaveRequest.companyId,
    fromDate: leaveRequest.fromDate,
    toDate: leaveRequest.toDate,
    durationType: leaveRequest.durationType,
    session,
  });

  for (const date of dates.chargeableDates) {
    await Attendance.findOneAndUpdate(
      {
        companyId: leaveRequest.companyId,
        employeeId: leaveRequest.employeeId,
        date,
        deletedAt: null,
      },
      {
        $set: {
          companyId: leaveRequest.companyId,
          employeeId: leaveRequest.employeeId,
          date,
          status: "ON_LEAVE",
          payableDayValue: leaveRequest.durationType === "HALF_DAY" ? 0.5 : 1,
          lopValue: leaveRequest.durationType === "HALF_DAY" ? 0.5 : 0,
          source: "leave",
        },
      },
      { upsert: true, new: true, session, setDefaultsOnInsert: true }
    );

    if (leaveRequest.durationType === "HALF_DAY") {
      await processEmployeeAttendance({ employee, date, source: "leave", session });
    }
  }
};

const approveLeave = async ({ user, leaveId, comment, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const leaveRequest = await LeaveRequest.findOne({ _id: leaveId, companyId, deletedAt: null }).session(session);
    if (!leaveRequest) throw new ApiError(404, "Leave request not found");
    if (String(leaveRequest.employeeId) === String(user._id)) throw new ApiError(403, "You cannot approve your own leave");
    if (leaveRequest.status !== "PENDING") throw new ApiError(400, "Only pending leave can be approved");

    const [employee, leaveType] = await Promise.all([
      User.findOne({ _id: leaveRequest.employeeId, companyId, deletedAt: null }).session(session),
      LeaveType.findOne({ _id: leaveRequest.leaveTypeId, companyId, deletedAt: null }).session(session),
    ]);

    if (!employee || !leaveType) throw new ApiError(404, "Leave employee or type not found");

    await approveLeaveDeduction({
      companyId,
      employeeId: employee._id,
      leaveType,
      year: leaveRequest.fromDate.getFullYear(),
      totalDays: leaveRequest.totalDays,
      actorId: user._id,
      session,
    });

    leaveRequest.status = "APPROVED";
    leaveRequest.approvedBy = user._id;
    leaveRequest.approvedAt = new Date();
    leaveRequest.currentApproverId = null;
    leaveRequest.updatedBy = user._id;
    leaveRequest.approvalHistory.push({ action: "APPROVED", actorId: user._id, comment, actedAt: new Date() });
    await leaveRequest.save({ session });

    await updateAttendanceForApprovedLeave({ leaveRequest, employee, session });

    await writeAuditLog({
      companyId,
      actorId: user._id,
      action: "leave_approved",
      entityType: "LeaveRequest",
      entityId: leaveRequest._id,
      metadata: { totalDays: leaveRequest.totalDays },
      req,
      session,
    });

    await session.commitTransaction();
    return leaveRequest.populate([
      { path: "employeeId", select: "fullName email employeeId department designation" },
      { path: "leaveTypeId", select: "name code paid" },
      { path: "approvedBy", select: "fullName email role" },
    ]);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const rejectLeave = async ({ user, leaveId, reason, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const leaveRequest = await LeaveRequest.findOne({ _id: leaveId, companyId, deletedAt: null }).session(session);
    if (!leaveRequest) throw new ApiError(404, "Leave request not found");
    if (String(leaveRequest.employeeId) === String(user._id)) throw new ApiError(403, "You cannot reject your own leave");
    if (leaveRequest.status !== "PENDING") throw new ApiError(400, "Only pending leave can be rejected");

    const leaveType = await LeaveType.findOne({ _id: leaveRequest.leaveTypeId, companyId, deletedAt: null }).session(session);
    if (!leaveType) throw new ApiError(404, "Leave type not found");

    await rejectLeaveRestore({
      companyId,
      employeeId: leaveRequest.employeeId,
      leaveType,
      year: leaveRequest.fromDate.getFullYear(),
      totalDays: leaveRequest.totalDays,
      actorId: user._id,
      session,
    });

    leaveRequest.status = "REJECTED";
    leaveRequest.rejectedBy = user._id;
    leaveRequest.rejectedAt = new Date();
    leaveRequest.rejectionReason = reason || "Rejected";
    leaveRequest.currentApproverId = null;
    leaveRequest.updatedBy = user._id;
    leaveRequest.approvalHistory.push({ action: "REJECTED", actorId: user._id, comment: reason, actedAt: new Date() });
    await leaveRequest.save({ session });

    await writeAuditLog({
      companyId,
      actorId: user._id,
      action: "leave_rejected",
      entityType: "LeaveRequest",
      entityId: leaveRequest._id,
      req,
      session,
    });

    await session.commitTransaction();
    return leaveRequest.populate([
      { path: "employeeId", select: "fullName email employeeId department designation" },
      { path: "leaveTypeId", select: "name code paid" },
      { path: "rejectedBy", select: "fullName email role" },
    ]);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const requestLeaveCancellation = async ({ user, leaveId, comment }) => {
  const companyId = getCompanyIdOrThrow(user);
  const leaveRequest = await LeaveRequest.findOne({
    _id: leaveId,
    companyId,
    employeeId: user._id,
    status: "APPROVED",
    deletedAt: null,
  });

  if (!leaveRequest) throw new ApiError(404, "Approved leave request not found");

  leaveRequest.status = "CANCEL_REQUESTED";
  leaveRequest.updatedBy = user._id;
  leaveRequest.approvalHistory.push({ action: "CANCEL_REQUESTED", actorId: user._id, comment, actedAt: new Date() });
  await leaveRequest.save();
  return leaveRequest;
};

const approveLeaveCancellation = async ({ user, leaveId, comment, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const leaveRequest = await LeaveRequest.findOne({ _id: leaveId, companyId, status: "CANCEL_REQUESTED", deletedAt: null }).session(session);
    if (!leaveRequest) throw new ApiError(404, "Cancellation request not found");

    const [employee, leaveType] = await Promise.all([
      User.findOne({ _id: leaveRequest.employeeId, companyId, deletedAt: null }).session(session),
      LeaveType.findOne({ _id: leaveRequest.leaveTypeId, companyId, deletedAt: null }).session(session),
    ]);

    if (!employee || !leaveType) throw new ApiError(404, "Leave employee or type not found");

    await cancelLeaveRestore({
      companyId,
      employeeId: leaveRequest.employeeId,
      leaveType,
      year: leaveRequest.fromDate.getFullYear(),
      totalDays: leaveRequest.totalDays,
      actorId: user._id,
      session,
    });

    leaveRequest.status = "CANCELLED";
    leaveRequest.cancelledAt = new Date();
    leaveRequest.updatedBy = user._id;
    leaveRequest.approvalHistory.push({ action: "CANCEL_APPROVED", actorId: user._id, comment, actedAt: new Date() });
    await leaveRequest.save({ session });

    const dates = await calculateLeaveDays({
      companyId,
      fromDate: leaveRequest.fromDate,
      toDate: leaveRequest.toDate,
      durationType: leaveRequest.durationType,
      session,
    });

    for (const date of dates.chargeableDates) {
      await processEmployeeAttendance({ employee, date, source: "auto_close", session });
    }

    await writeAuditLog({
      companyId,
      actorId: user._id,
      action: "leave_cancelled",
      entityType: "LeaveRequest",
      entityId: leaveRequest._id,
      req,
      session,
    });

    await session.commitTransaction();
    return leaveRequest;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getLeaveReport = async ({ user, month }) => {
  const companyId = assertCompanyScopedUser(user);
  const query = { companyId, deletedAt: null };
  const parsed = month ? parseMonthParam(month) : null;

  if (parsed) {
    query.fromDate = { $lte: parsed.to };
    query.toDate = { $gte: parsed.from };
  }

  return LeaveRequest.find(query)
    .populate("employeeId", "fullName email employeeId department designation")
    .populate("leaveTypeId", "name code paid")
    .sort({ fromDate: -1 });
};

module.exports = {
  listLeaveTypes,
  createLeaveType,
  updateLeaveType,
  softDeleteLeaveType,
  getMyLeaveBalance,
  applyLeave,
  getMyLeaveRequests,
  getPendingLeaveApprovals,
  approveLeave,
  rejectLeave,
  requestLeaveCancellation,
  approveLeaveCancellation,
  getLeaveReport,
};
