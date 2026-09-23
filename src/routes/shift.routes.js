const express = require("express");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles, ATTENDANCE_MANAGE_ROLES } = require("../middlewares/role.middleware");
const {
  listShiftsController,
  createShiftController,
  updateShiftController,
  deleteShiftController,
  assignShiftController,
} = require("../controllers/shift.controller");
const {
  validateShiftPayload,
  validateShiftAssignment,
  validateObjectIdParam,
} = require("../validators/attendance.validator");

const router = express.Router();

router.use(authenticate);

router.get("/", allowRoles(...ATTENDANCE_MANAGE_ROLES, "hr_executive", "hr_general"), listShiftsController);
router.post("/", allowRoles(...ATTENDANCE_MANAGE_ROLES), validateShiftPayload, createShiftController);
router.patch("/:id", allowRoles(...ATTENDANCE_MANAGE_ROLES), validateObjectIdParam("id"), validateShiftPayload, updateShiftController);
router.delete("/:id", allowRoles(...ATTENDANCE_MANAGE_ROLES), validateObjectIdParam("id"), deleteShiftController);
router.post("/assign", allowRoles(...ATTENDANCE_MANAGE_ROLES, "hr_executive"), validateShiftAssignment, assignShiftController);

module.exports = router;

