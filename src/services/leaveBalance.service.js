const LeaveBalance = require("../models/LeaveBalance");
const LeavePolicy = require("../models/LeavePolicy");
const ApiError = require("../utils/ApiError");
const { eachDateInclusive, startOfDay } = require("../utils/dateTime");
const { isHoliday } = require("./holiday.service");
const { isWeeklyOff } = require("./weeklyOff.service");

const getDefaultLeavePolicy = async ({ companyId, session = null }) => {
  const query = LeavePolicy.findOne({
    companyId,
    isDefault: true,
    isActive: true,
    deletedAt: null,
  }).sort({ updatedAt: -1 });

  if (session) query.session(session);

  return query;
};

const getOrCreateLeaveBalance = async ({ companyId, employeeId, leaveType, year, actorId = null, session = null }) => {
  const defaults = {
    companyId,
    employeeId,
    leaveTypeId: leaveType._id,
    year,
    openingBalance: 0,
    credited: leaveType.yearlyQuota || leaveType.accrualValue || 0,
    used: 0,
    pending: 0,
    available: leaveType.yearlyQuota || leaveType.accrualValue || 0,
    carriedForward: 0,
    lapsed: 0,
    updatedBy: actorId,
  };

  const update = { $setOnInsert: defaults };
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  if (session) options.session = session;

  return LeaveBalance.findOneAndUpdate(
    { companyId, employeeId, leaveTypeId: leaveType._id, year },
    update,
    options
  );
};

const calculateLeaveDays = async ({ companyId, fromDate, toDate, durationType, session = null }) => {
  if (durationType === "HALF_DAY") {
    return { totalDays: 0.5, chargeableDates: [startOfDay(fromDate)] };
  }

  const leavePolicy = await getDefaultLeavePolicy({ companyId, session });
  const includeNonWorkingDays = Boolean(leavePolicy?.sandwichRuleEnabled);
  const dates = eachDateInclusive(fromDate, toDate);
  const chargeableDates = [];

  for (const date of dates) {
    if (!includeNonWorkingDays) {
      const [holiday, weeklyOff] = await Promise.all([
        isHoliday({ companyId, date, session }),
        isWeeklyOff({ companyId, date, session }),
      ]);
      if (holiday || weeklyOff) continue;
    }
    chargeableDates.push(date);
  }

  return {
    totalDays: chargeableDates.length,
    chargeableDates,
  };
};

const blockPendingLeave = async ({ companyId, employeeId, leaveType, year, totalDays, actorId, session }) => {
  const balance = await getOrCreateLeaveBalance({ companyId, employeeId, leaveType, year, actorId, session });

  if (!leaveType.paid) {
    return balance;
  }

  if (!leaveType.allowNegativeBalance && balance.available < totalDays) {
    throw new ApiError(400, "Insufficient leave balance");
  }

  balance.pending += totalDays;
  balance.available -= totalDays;
  balance.updatedBy = actorId;
  await balance.save({ session });

  return balance;
};

const approveLeaveDeduction = async ({ companyId, employeeId, leaveType, year, totalDays, actorId, session }) => {
  const balance = await getOrCreateLeaveBalance({ companyId, employeeId, leaveType, year, actorId, session });

  if (!leaveType.paid) {
    return balance;
  }

  balance.pending = Math.max(0, balance.pending - totalDays);
  balance.used += totalDays;
  balance.updatedBy = actorId;
  await balance.save({ session });
  return balance;
};

const rejectLeaveRestore = async ({ companyId, employeeId, leaveType, year, totalDays, actorId, session }) => {
  const balance = await getOrCreateLeaveBalance({ companyId, employeeId, leaveType, year, actorId, session });

  if (!leaveType.paid) {
    return balance;
  }

  balance.pending = Math.max(0, balance.pending - totalDays);
  balance.available += totalDays;
  balance.updatedBy = actorId;
  await balance.save({ session });
  return balance;
};

const cancelLeaveRestore = async ({ companyId, employeeId, leaveType, year, totalDays, actorId, session }) => {
  const balance = await getOrCreateLeaveBalance({ companyId, employeeId, leaveType, year, actorId, session });

  if (!leaveType.paid) {
    return balance;
  }

  balance.used = Math.max(0, balance.used - totalDays);
  balance.available += totalDays;
  balance.updatedBy = actorId;
  await balance.save({ session });
  return balance;
};

module.exports = {
  getDefaultLeavePolicy,
  getOrCreateLeaveBalance,
  calculateLeaveDays,
  blockPendingLeave,
  approveLeaveDeduction,
  rejectLeaveRestore,
  cancelLeaveRestore,
};
