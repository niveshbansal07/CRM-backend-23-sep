const mongoose = require("mongoose");
const User = require("../models/User");
const Attendance = require("../models/Attendance");
const AttendanceCorrectionRequest = require("../models/AttendanceCorrectionRequest");
const ApiError = require("../utils/ApiError");
const { startOfDay } = require("../utils/dateTime");
const { getCompanyIdOrThrow, assertCompanyScopedUser } = require("./tenant.service");
const { processEmployeeAttendance } = require("./attendanceProcessor.service");
const { writeAuditLog } = require("./auditLog.service");

const applyCorrectionRequest = async ({ user, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const date = startOfDay(payload.date);

  const existingPending = await AttendanceCorrectionRequest.findOne({
    companyId,
    employeeId: user._id,
    date,
    status: "PENDING",
    deletedAt: null,
  });

  if (existingPending) {
    throw new ApiError(409, "A pending correction request already exists for this date");
  }

  let attendanceId = payload.attendanceId || null;
  if (attendanceId) {
    const attendance = await Attendance.findOne({
      _id: attendanceId,
      companyId,
      employeeId: user._id,
      deletedAt: null,
    });
    if (!attendance) throw new ApiError(404, "Attendance record not found");
  } else {
    const attendance = await Attendance.findOne({ companyId, employeeId: user._id, date, deletedAt: null });
    attendanceId = attendance?._id || null;
  }

  const request = await AttendanceCorrectionRequest.create({
    companyId,
    employeeId: user._id,
    attendanceId,
    date,
    type: payload.type,
    requestedPunchIn: payload.requestedPunchIn,
    requestedPunchOut: payload.requestedPunchOut,
    reason: payload.reason,
    attachmentUrl: payload.attachmentUrl,
    createdBy: user._id,
    updatedBy: user._id,
  });

  if (attendanceId) {
    await Attendance.updateOne({ _id: attendanceId }, { $set: { status: "PENDING_CORRECTION" } });
  }

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "attendance_correction_requested",
    entityType: "AttendanceCorrectionRequest",
    entityId: request._id,
    req,
  });

  return request;
};

const getMyCorrectionRequests = async ({ user }) => {
  const companyId = getCompanyIdOrThrow(user);
  return AttendanceCorrectionRequest.find({ companyId, employeeId: user._id, deletedAt: null })
    .populate("attendanceId", "date status punchInAt punchOutAt")
    .populate("approvedBy rejectedBy", "fullName email role")
    .sort({ createdAt: -1 });
};

const getPendingCorrections = async ({ user }) => {
  const companyId = assertCompanyScopedUser(user);
  return AttendanceCorrectionRequest.find({ companyId, status: "PENDING", deletedAt: null })
    .populate("employeeId", "fullName email employeeId department designation")
    .populate("attendanceId", "date status punchInAt punchOutAt")
    .sort({ createdAt: 1 });
};

const approveCorrection = async ({ user, requestId, comment, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const correction = await AttendanceCorrectionRequest.findOne({
      _id: requestId,
      companyId,
      status: "PENDING",
      deletedAt: null,
    }).session(session);

    if (!correction) throw new ApiError(404, "Correction request not found");
    if (String(correction.employeeId) === String(user._id)) {
      throw new ApiError(403, "You cannot approve your own correction request");
    }

    const employee = await User.findOne({ _id: correction.employeeId, companyId, deletedAt: null }).session(session);
    if (!employee) throw new ApiError(404, "Employee not found");

    let attendance = await Attendance.findOne({
      companyId,
      employeeId: correction.employeeId,
      date: correction.date,
      deletedAt: null,
    }).session(session);

    if (!attendance) {
      attendance = new Attendance({
        companyId,
        employeeId: correction.employeeId,
        date: correction.date,
        source: "correction",
      });
    }

    if (correction.requestedPunchIn) attendance.punchInAt = correction.requestedPunchIn;
    if (correction.requestedPunchOut) attendance.punchOutAt = correction.requestedPunchOut;

    if (["WORK_FROM_HOME", "ON_DUTY", "CLIENT_VISIT", "MANUAL_PRESENT"].includes(correction.type)) {
      attendance.punchInAt = correction.requestedPunchIn || attendance.punchInAt || correction.date;
      attendance.punchOutAt = correction.requestedPunchOut || attendance.punchOutAt || correction.date;
      attendance.status = correction.type === "WORK_FROM_HOME" ? "WORK_FROM_HOME" : "PRESENT";
      attendance.payableDayValue = 1;
      attendance.lopValue = 0;
    }

    attendance.isRegularized = true;
    attendance.regularizedBy = user._id;
    attendance.regularizedAt = new Date();
    attendance.source = "correction";
    attendance.remarks = comment || correction.reason;
    attendance.punchStatus = attendance.punchInAt && attendance.punchOutAt ? "PUNCHED_OUT" : "PUNCHED_IN";
    await attendance.save({ session });

    if (!["WORK_FROM_HOME", "ON_DUTY", "CLIENT_VISIT", "MANUAL_PRESENT"].includes(correction.type)) {
      await processEmployeeAttendance({ employee, date: correction.date, source: "correction", session });
    }

    correction.status = "APPROVED";
    correction.approvedBy = user._id;
    correction.approvedAt = new Date();
    correction.reviewerComment = comment;
    correction.updatedBy = user._id;
    correction.attendanceId = attendance._id;
    await correction.save({ session });

    await writeAuditLog({
      companyId,
      actorId: user._id,
      action: "attendance_correction_approved",
      entityType: "AttendanceCorrectionRequest",
      entityId: correction._id,
      metadata: { attendanceId: attendance._id },
      req,
      session,
    });

    await session.commitTransaction();
    return correction.populate([
      { path: "employeeId", select: "fullName email employeeId department designation" },
      { path: "attendanceId", select: "date status punchInAt punchOutAt totalWorkMinutes" },
      { path: "approvedBy", select: "fullName email role" },
    ]);
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const rejectCorrection = async ({ user, requestId, reason, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const correction = await AttendanceCorrectionRequest.findOne({
    _id: requestId,
    companyId,
    status: "PENDING",
    deletedAt: null,
  });

  if (!correction) throw new ApiError(404, "Correction request not found");
  if (String(correction.employeeId) === String(user._id)) {
    throw new ApiError(403, "You cannot reject your own correction request");
  }

  correction.status = "REJECTED";
  correction.rejectedBy = user._id;
  correction.rejectedAt = new Date();
  correction.rejectedReason = reason || "Rejected";
  correction.updatedBy = user._id;
  await correction.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "attendance_correction_rejected",
    entityType: "AttendanceCorrectionRequest",
    entityId: correction._id,
    req,
  });

  return correction.populate([
    { path: "employeeId", select: "fullName email employeeId department designation" },
    { path: "attendanceId", select: "date status punchInAt punchOutAt" },
    { path: "rejectedBy", select: "fullName email role" },
  ]);
};

module.exports = {
  applyCorrectionRequest,
  getMyCorrectionRequests,
  getPendingCorrections,
  approveCorrection,
  rejectCorrection,
};
