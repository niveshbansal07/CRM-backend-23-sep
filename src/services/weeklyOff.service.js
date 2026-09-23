const WeeklyOffPolicy = require("../models/WeeklyOffPolicy");
const { startOfDay } = require("../utils/dateTime");

const getWeekOfMonth = (date) => Math.ceil(startOfDay(date).getDate() / 7);

const getDefaultWeeklyOffPolicy = async ({ companyId, session = null }) => {
  const query = WeeklyOffPolicy.findOne({
    companyId,
    isDefault: true,
    isActive: true,
    deletedAt: null,
  }).sort({ updatedAt: -1 });

  if (session) query.session(session);

  return query;
};

const isWeeklyOff = async ({ companyId, date, attendancePolicy = null, session = null }) => {
  const targetDate = startOfDay(date);
  const day = targetDate.getDay();
  const policy = await getDefaultWeeklyOffPolicy({ companyId, session });

  if (policy) {
    if (policy.secondAndFourthSaturdayOff && day === 6 && [2, 4].includes(getWeekOfMonth(targetDate))) {
      return true;
    }
    return policy.weeklyOffDays.includes(day);
  }

  const weeklyOffs = attendancePolicy?.weeklyOffs || [0, 6];
  return weeklyOffs.includes(day);
};

module.exports = {
  getDefaultWeeklyOffPolicy,
  isWeeklyOff,
};
