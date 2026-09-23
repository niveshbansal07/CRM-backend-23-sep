const Attendance = require("../models/Attendance");
const LeaveRequest = require("../models/LeaveRequest");
const { startOfDay, parseTimeOnDate, minutesBetween, monthRange, addDays } = require("../utils/dateTime");
const { getDefaultPolicyForCompany } = require("./attendancePolicy.service");
const { getEmployeeActiveShift } = require("./shift.service");
const { isHoliday } = require("./holiday.service");
const { isWeeklyOff } = require("./weeklyOff.service");

const resolveShiftBounds = (date, shift) => {
  const start = parseTimeOnDate(date, shift.startTime);
  let end = parseTimeOnDate(date, shift.endTime);

  if (shift.isNightShift && end <= start) {
    end = addDays(end, 1);
  }

  return { start, end };
};

const calculateWorkingMinutes = ({ punchInAt, punchOutAt, breakMinutes = 0 }) => {
  if (!punchInAt || !punchOutAt) return 0;
  return Math.max(0, minutesBetween(punchInAt, punchOutAt) - Number(breakMinutes || 0));
};

const countLateMarksForMonth = async ({ companyId, employeeId, date, session = null }) => {
  const target = startOfDay(date);
  const { from, to } = monthRange(target.getFullYear(), target.getMonth() + 1);
  const query = Attendance.countDocuments({
    companyId,
    employeeId,
    date: { $gte: from, $lte: to, $lt: target },
    status: { $in: ["LATE", "HALF_DAY", "LOSS_OF_PAY"] },
    lateByMinutes: { $gt: 0 },
    deletedAt: null,
  });

  if (session) query.session(session);

  return query;
};

const countConsecutiveLateBeforeDate = async ({ companyId, employeeId, date, session = null }) => {
  let cursor = addDays(startOfDay(date), -1);
  let count = 0;

  for (let index = 0; index < 10; index += 1) {
    const query = Attendance.findOne({
      companyId,
      employeeId,
      date: cursor,
      lateByMinutes: { $gt: 0 },
      deletedAt: null,
    }).select("lateByMinutes");

    if (session) query.session(session);

    const attendance = await query;
    if (!attendance) break;
    count += 1;
    cursor = addDays(cursor, -1);
  }

  return count;
};

const applyLatePenalty = async ({ result, policy, companyId, employeeId, date, session = null }) => {
  if (!result.lateByMinutes) return result;

  const monthlyLateCount = await countLateMarksForMonth({ companyId, employeeId, date, session });
  const consecutiveLateCount = await countConsecutiveLateBeforeDate({ companyId, employeeId, date, session });

  if (policy.consecutiveLateLimit && consecutiveLateCount + 1 > policy.consecutiveLateLimit) {
    if (policy.afterConsecutiveLatePenalty === "LOSS_OF_PAY") {
      result.status = "LOSS_OF_PAY";
      result.payableDayValue = 0;
      result.lopValue = 1;
    } else if (policy.afterConsecutiveLatePenalty === "HALF_DAY") {
      result.status = "HALF_DAY";
      result.payableDayValue = 0.5;
      result.lopValue = 0.5;
    } else {
      result.status = "ABSENT";
      result.payableDayValue = 0;
      result.lopValue = 1;
    }
    return result;
  }

  if (monthlyLateCount + 1 > policy.lateAllowedPerMonth) {
    if (policy.thirdLatePenalty === "LOSS_OF_PAY") {
      result.status = "LOSS_OF_PAY";
      result.payableDayValue = 0;
      result.lopValue = 1;
    } else if (policy.thirdLatePenalty === "ABSENT") {
      result.status = "ABSENT";
      result.payableDayValue = 0;
      result.lopValue = 1;
    } else {
      result.status = "HALF_DAY";
      result.payableDayValue = 0.5;
      result.lopValue = 0.5;
    }
    return result;
  }

  if (result.status === "PRESENT") result.status = "LATE";
  return result;
};

const calculateAttendanceStatus = async ({ attendance, employee, date, session = null }) => {
  const companyId = employee.companyId;
  const targetDate = startOfDay(date);
  const policy = await getDefaultPolicyForCompany(companyId, session);
  const shift = await getEmployeeActiveShift({ companyId, employeeId: employee._id, date: targetDate, session });
  const [holiday, weeklyOff, approvedLeave] = await Promise.all([
    isHoliday({ companyId, date: targetDate, session }),
    isWeeklyOff({ companyId, date: targetDate, attendancePolicy: policy, session }),
    LeaveRequest.findOne({
      companyId,
      employeeId: employee._id,
      status: "APPROVED",
      fromDate: { $lte: targetDate },
      toDate: { $gte: targetDate },
      deletedAt: null,
    }).session(session),
  ]);

  const hasPunchIn = Boolean(attendance?.punchInAt);
  const hasPunchOut = Boolean(attendance?.punchOutAt);

  const base = {
    shiftId: shift?._id || attendance?.shiftId || null,
    status: "ABSENT",
    lateByMinutes: 0,
    earlyOutMinutes: 0,
    totalWorkMinutes: 0,
    overtimeMinutes: 0,
    payableDayValue: 0,
    lopValue: 1,
  };

  if (holiday && !hasPunchIn) return { ...base, status: "HOLIDAY", payableDayValue: 1, lopValue: 0 };
  if (weeklyOff && !hasPunchIn) return { ...base, status: "WEEKLY_OFF", payableDayValue: 1, lopValue: 0 };

  if (approvedLeave && approvedLeave.durationType !== "HALF_DAY") {
    return { ...base, status: "ON_LEAVE", payableDayValue: 1, lopValue: 0 };
  }

  if (!hasPunchIn && !hasPunchOut) {
    if (approvedLeave?.durationType === "HALF_DAY") {
      return { ...base, status: "ON_LEAVE", payableDayValue: 0.5, lopValue: 0.5 };
    }
    return base;
  }

  if (hasPunchIn && !hasPunchOut) {
    return { ...base, status: "MISSED_PUNCH", payableDayValue: 0, lopValue: 1 };
  }

  const fullDayMinutes = shift?.fullDayMinutes || policy.fullDayMinutes;
  const halfDayMinutes = shift?.halfDayMinutes || policy.halfDayMinutes;
  const breakMinutes = shift?.breakMinutes ?? policy.breakMinutes;
  const graceMinutes = shift?.graceMinutes ?? policy.graceMinutes;
  const totalWorkMinutes = calculateWorkingMinutes({
    punchInAt: attendance.punchInAt,
    punchOutAt: attendance.punchOutAt,
    breakMinutes,
  });

  const shiftBounds = shift ? resolveShiftBounds(targetDate, shift) : null;
  const lateByMinutes = shiftBounds
    ? Math.max(0, minutesBetween(shiftBounds.start, attendance.punchInAt) - graceMinutes)
    : 0;
  const earlyOutMinutes = shiftBounds ? Math.max(0, minutesBetween(attendance.punchOutAt, shiftBounds.end)) : 0;
  const overtimeMinutes = policy.overtimeEnabled
    ? Math.max(0, totalWorkMinutes - Number(policy.overtimeAfterMinutes || fullDayMinutes))
    : 0;

  let result = {
    ...base,
    status: "ABSENT",
    lateByMinutes,
    earlyOutMinutes,
    totalWorkMinutes,
    overtimeMinutes,
    payableDayValue: 0,
    lopValue: 1,
  };

  if (holiday) result.status = "HOLIDAY_WORKED";
  else if (weeklyOff) result.status = "WEEKLY_OFF_WORKED";
  else if (approvedLeave?.durationType === "HALF_DAY" && totalWorkMinutes >= halfDayMinutes) result.status = "HALF_DAY_LEAVE_HALF_DAY_PRESENT";
  else if (totalWorkMinutes >= fullDayMinutes) result.status = overtimeMinutes > 0 ? "OVERTIME" : "PRESENT";
  else if (totalWorkMinutes >= halfDayMinutes) result.status = earlyOutMinutes > 0 ? "EARLY_OUT" : "HALF_DAY";

  if (["PRESENT", "OVERTIME", "HOLIDAY_WORKED", "WEEKLY_OFF_WORKED"].includes(result.status)) {
    result.payableDayValue = 1;
    result.lopValue = 0;
  } else if (["HALF_DAY", "EARLY_OUT", "HALF_DAY_LEAVE_HALF_DAY_PRESENT"].includes(result.status)) {
    result.payableDayValue = 0.5;
    result.lopValue = 0.5;
  }

  if (!holiday && !weeklyOff && result.lateByMinutes > 0 && ["PRESENT", "OVERTIME"].includes(result.status)) {
    result = await applyLatePenalty({ result, policy, companyId, employeeId: employee._id, date: targetDate, session });
  }

  return result;
};

const processEmployeeAttendance = async ({ employee, date, source = "auto_close", session = null }) => {
  const targetDate = startOfDay(date);
  const query = Attendance.findOne({
    companyId: employee.companyId,
    employeeId: employee._id,
    date: targetDate,
    deletedAt: null,
  });

  if (session) query.session(session);

  let attendance = await query;
  if (!attendance) {
    attendance = new Attendance({
      companyId: employee.companyId,
      employeeId: employee._id,
      date: targetDate,
      source,
    });
  }

  const result = await calculateAttendanceStatus({ attendance, employee, date: targetDate, session });
  Object.assign(attendance, result, { source });
  await attendance.save({ session });
  return attendance;
};

module.exports = {
  resolveShiftBounds,
  calculateWorkingMinutes,
  calculateAttendanceStatus,
  processEmployeeAttendance,
};
