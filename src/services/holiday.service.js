const HolidayCalendar = require("../models/HolidayCalendar");
const ApiError = require("../utils/ApiError");
const { startOfDay, isSameDay } = require("../utils/dateTime");
const { assertCompanyScopedUser, getCompanyIdOrThrow } = require("./tenant.service");
const { writeAuditLog } = require("./auditLog.service");

const listHolidayCalendars = async ({ user, year }) => {
  const companyId = assertCompanyScopedUser(user);
  const query = { companyId, deletedAt: null };

  if (year) query.year = Number(year);

  return HolidayCalendar.find(query).sort({ year: -1, name: 1 });
};

const createHolidayCalendar = async ({ user, payload, req }) => {
  const companyId = assertCompanyScopedUser(user);

  const calendar = await HolidayCalendar.findOneAndUpdate(
    { companyId, year: payload.year, deletedAt: null },
    {
      $set: {
        name: payload.name,
        holidays: payload.holidays.map((holiday) => ({
          ...holiday,
          date: startOfDay(holiday.date),
        })),
        updatedBy: user._id,
      },
      $setOnInsert: {
        companyId,
        year: payload.year,
        createdBy: user._id,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "holiday_calendar_upserted",
    entityType: "HolidayCalendar",
    entityId: calendar._id,
    metadata: { year: calendar.year },
    req,
  });

  return calendar;
};

const updateHolidayCalendar = async ({ user, calendarId, payload, req }) => {
  const companyId = getCompanyIdOrThrow(user);
  const calendar = await HolidayCalendar.findOne({ _id: calendarId, companyId, deletedAt: null });

  if (!calendar) {
    throw new ApiError(404, "Holiday calendar not found");
  }

  calendar.name = payload.name || calendar.name;
  if (payload.year) calendar.year = payload.year;
  if (payload.holidays) {
    calendar.holidays = payload.holidays.map((holiday) => ({
      ...holiday,
      date: startOfDay(holiday.date),
    }));
  }
  calendar.updatedBy = user._id;
  await calendar.save();

  await writeAuditLog({
    companyId,
    actorId: user._id,
    action: "holiday_calendar_updated",
    entityType: "HolidayCalendar",
    entityId: calendar._id,
    req,
  });

  return calendar;
};

const getHolidayDetails = async ({ companyId, date, session = null }) => {
  const targetDate = startOfDay(date);
  const year = targetDate.getFullYear();
  const query = HolidayCalendar.findOne({ companyId, year, deletedAt: null });

  if (session) query.session(session);

  const calendar = await query;
  if (!calendar) return null;

  return calendar.holidays.find((holiday) => isSameDay(holiday.date, targetDate)) || null;
};

const isHoliday = async ({ companyId, date, session = null }) => Boolean(await getHolidayDetails({ companyId, date, session }));

module.exports = {
  listHolidayCalendars,
  createHolidayCalendar,
  updateHolidayCalendar,
  getHolidayDetails,
  isHoliday,
};
