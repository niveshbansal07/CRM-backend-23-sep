const User = require("../models/User");
const Attendance = require("../models/Attendance");
const ApiError = require("../utils/ApiError");
const { startOfDay, monthRange, parseMonthParam } = require("../utils/dateTime");
const { getCompanyIdOrThrow, assertCompanyScopedUser } = require("./tenant.service");
const { getEmployeeActiveShift } = require("./shift.service");
const { calculateAttendanceStatus, processEmployeeAttendance } = require("./attendanceProcessor.service");
const { writeAuditLog } = require("./auditLog.service");
const { EMPLOYEE_ACCOUNT_ROLES } = require("../utils/employeeRole");

const EMPLOYEE_PUNCH_ROLES = EMPLOYEE_ACCOUNT_ROLES;

const getRequestIp = (req) => req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || "";

const getDeviceType = (body = {}) => {
  if (["web", "mobile"].includes(body.deviceType)) return body.deviceType;
  return "web";
};

const assertCanPunch = (user) => {
  if (!EMPLOYEE_PUNCH_ROLES.includes(user.role)) {
    throw new ApiError(403, "Only employees and HR users can punch attendance");
  }

  if (!["active"].includes(user.status)) {
    throw new ApiError(403, "Only active employees can punch attendance");
  }

  return getCompanyIdOrThrow(user);
};

const getTodayAttendance = async ({ user }) => {
  const companyId = getCompanyIdOrThrow(user);
  const today = startOfDay(new Date());
  const attendance = await Attendance.findOne({
    companyId,
    employeeId: user._id,
    date: today,
    deletedAt: null,
  }).populate("shiftId", "name startTime endTime");
  const shift = await getEmployeeActiveShift({ companyId, employeeId: user._id, date: today });

  return { attendance, shift };
};

const punchIn = async ({ user, body, req }) => {
  const companyId = assertCanPunch(user);
  const now = new Date();
  const today = startOfDay(now);
  const activeShift = await getEmployeeActiveShift({ companyId, employeeId: user._id, date: today });

  if (!activeShift) {
    throw new ApiError(400, "Active shift is required before punch-in");
  }

  let attendance = await Attendance.findOne({ companyId, employeeId: user._id, date: today, deletedAt: null });

  if (attendance?.punchInAt) {
    throw new ApiError(409, "You have already punched in today");
  }

  if (!attendance) {
    attendance = new Attendance({
      companyId,
      employeeId: user._id,
      date: today,
      shiftId: activeShift._id,
      source: "punch",
    });
  }

  attendance.punchInAt = now;
  attendance.punchInIp = getRequestIp(req);
  attendance.punchInUserAgent = req.headers["user-agent"] || "";
  attendance.punchInLocation = body?.location || null;
  attendance.deviceType = getDeviceType(body);
  attendance.punchStatus = "PUNCHED_IN";

  const result = await calculateAttendanceStatus({ attendance, employee: user, date: today });
  Object.assign(attendance, result, { source: "punch" });
  await attendance.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "attendance_punched_in",
    entityType: "Attendance",
    entityId: attendance._id,
    req,
  });

  return attendance.populate("shiftId", "name startTime endTime");
};

const punchOut = async ({ user, body, req }) => {
  const companyId = assertCanPunch(user);
  const now = new Date();
  const today = startOfDay(now);
  const attendance = await Attendance.findOne({ companyId, employeeId: user._id, date: today, deletedAt: null });

  if (!attendance?.punchInAt) {
    throw new ApiError(400, "Punch-in is required before punch-out");
  }

  if (attendance.punchOutAt) {
    throw new ApiError(409, "You have already punched out today");
  }

  attendance.punchOutAt = now;
  attendance.punchOutIp = getRequestIp(req);
  attendance.punchOutUserAgent = req.headers["user-agent"] || "";
  attendance.punchOutLocation = body?.location || null;
  attendance.deviceType = getDeviceType(body);
  attendance.punchStatus = "PUNCHED_OUT";

  const result = await calculateAttendanceStatus({ attendance, employee: user, date: today });
  Object.assign(attendance, result, { source: "punch" });
  await attendance.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "attendance_punched_out",
    entityType: "Attendance",
    entityId: attendance._id,
    req,
  });

  return attendance.populate("shiftId", "name startTime endTime");
};

const getMyMonthlyAttendance = async ({ user, month }) => {
  const parsed = parseMonthParam(month);
  if (!parsed) {
    throw new ApiError(400, "month must use YYYY-MM format");
  }

  const companyId = getCompanyIdOrThrow(user);
  const records = await Attendance.find({
    companyId,
    employeeId: user._id,
    date: { $gte: parsed.from, $lte: parsed.to },
    deletedAt: null,
  })
    .populate("shiftId", "name startTime endTime")
    .sort({ date: 1 });

  return { month, records };
};

const getCompanyDailyAttendance = async ({ user, date }) => {
  const companyId = assertCompanyScopedUser(user);
  const targetDate = startOfDay(date || new Date());

  return Attendance.find({
    companyId,
    date: targetDate,
    deletedAt: null,
  })
    .populate("employeeId", "fullName email employeeId department designation role")
    .populate("shiftId", "name startTime endTime")
    .sort({ "employeeId.fullName": 1 });
};

const getCompanyMonthlyAttendance = async ({ user, month }) => {
  const parsed = parseMonthParam(month);
  if (!parsed) {
    throw new ApiError(400, "month must use YYYY-MM format");
  }

  const companyId = assertCompanyScopedUser(user);
  const records = await Attendance.find({
    companyId,
    date: { $gte: parsed.from, $lte: parsed.to },
    deletedAt: null,
  })
    .populate("employeeId", "fullName email employeeId department designation role")
    .populate("shiftId", "name startTime endTime")
    .sort({ date: 1 });

  return { month, records };
};

const processDailyAttendance = async ({ user, date }) => {
  const companyId = assertCompanyScopedUser(user);
  const targetDate = startOfDay(date || new Date());
  const employees = await User.find({
    companyId,
    role: { $in: EMPLOYEE_PUNCH_ROLES },
    status: "active",
    deletedAt: null,
  });

  const processed = [];
  for (const employee of employees) {
    processed.push(await processEmployeeAttendance({ employee, date: targetDate, source: "auto_close" }));
  }

  return processed;
};

const getPayrollReadySummary = async ({ user, employeeId, month }) => {
  const parsed = parseMonthParam(month);
  if (!parsed) {
    throw new ApiError(400, "month must use YYYY-MM format");
  }

  const companyId = assertCompanyScopedUser(user);
  const query = {
    companyId,
    date: { $gte: parsed.from, $lte: parsed.to },
    deletedAt: null,
  };

  if (employeeId) query.employeeId = employeeId;

  const records = await Attendance.find(query).populate("employeeId", "fullName email employeeId department designation");
  const summaries = new Map();

  records.forEach((record) => {
    const key = String(record.employeeId?._id || record.employeeId);
    const current = summaries.get(key) || {
      employee: record.employeeId,
      presentDays: 0,
      paidLeaveDays: 0,
      absentDays: 0,
      halfDays: 0,
      lopDays: 0,
      overtimeMinutes: 0,
      payableDays: 0,
    };

    current.payableDays += record.payableDayValue || 0;
    current.lopDays += record.lopValue || 0;
    current.overtimeMinutes += record.overtimeMinutes || 0;

    if (["PRESENT", "LATE", "OVERTIME", "HOLIDAY_WORKED", "WEEKLY_OFF_WORKED"].includes(record.status)) current.presentDays += 1;
    if (record.status === "ON_LEAVE") current.paidLeaveDays += 1;
    if (record.status === "ABSENT") current.absentDays += 1;
    if (["HALF_DAY", "EARLY_OUT", "HALF_DAY_LEAVE_HALF_DAY_PRESENT"].includes(record.status)) current.halfDays += 1;

    summaries.set(key, current);
  });

  return Array.from(summaries.values());
};

module.exports = {
  getTodayAttendance,
  punchIn,
  punchOut,
  getMyMonthlyAttendance,
  getCompanyDailyAttendance,
  getCompanyMonthlyAttendance,
  processDailyAttendance,
  getPayrollReadySummary,
};
