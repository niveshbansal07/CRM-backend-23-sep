const ApiResponse = require("../utils/ApiResponse");
const {
  listHolidayCalendars,
  createHolidayCalendar,
  updateHolidayCalendar,
} = require("../services/holiday.service");

const listHolidayCalendarsController = async (req, res, next) => {
  try {
    const calendars = await listHolidayCalendars({ user: req.user, year: req.query.year });
    res.status(200).json(new ApiResponse(200, "Holiday calendars fetched successfully", { calendars }));
  } catch (error) {
    next(error);
  }
};

const createHolidayCalendarController = async (req, res, next) => {
  try {
    const calendar = await createHolidayCalendar({ user: req.user, payload: req.validatedBody, req });
    res.status(201).json(new ApiResponse(201, "Holiday calendar saved successfully", { calendar }));
  } catch (error) {
    next(error);
  }
};

const updateHolidayCalendarController = async (req, res, next) => {
  try {
    const calendar = await updateHolidayCalendar({
      user: req.user,
      calendarId: req.params.id,
      payload: req.validatedBody,
      req,
    });
    res.status(200).json(new ApiResponse(200, "Holiday calendar updated successfully", { calendar }));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listHolidayCalendarsController,
  createHolidayCalendarController,
  updateHolidayCalendarController,
};
