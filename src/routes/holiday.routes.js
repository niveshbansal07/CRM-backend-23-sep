const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles, ATTENDANCE_POLICY_ROLES } = require("../middlewares/role.middleware");
const {
  listHolidayCalendarsController,
  createHolidayCalendarController,
  updateHolidayCalendarController,
} = require("../controllers/holiday.controller");
const {
  validateHolidayCalendar,
  validateObjectIdParam,
} = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", allowRoles(...ATTENDANCE_POLICY_ROLES, "hr_head", "hr_manager", "hr_general", "hr_executive"), listHolidayCalendarsController);
router.post("/", allowRoles(...ATTENDANCE_POLICY_ROLES), validateHolidayCalendar, createHolidayCalendarController);
router.patch("/:id", allowRoles(...ATTENDANCE_POLICY_ROLES), validateObjectIdParam("id"), validateHolidayCalendar, updateHolidayCalendarController);

module.exports = router;

