const User = require("../models/User");
const { startOfDay, addDays } = require("../utils/dateTime");
const { processEmployeeAttendance } = require("../services/attendanceProcessor.service");

let cronStarted = false;
let fallbackTimer = null;

const processAttendanceForAllCompanies = async (date = addDays(new Date(), -1)) => {
  const targetDate = startOfDay(date);
  const employees = await User.find({
    role: { $in: ["employee", "user", "hr_executive", "hr_general", "hr_manager", "hr_head"] },
    status: "active",
    companyId: { $ne: null },
    deletedAt: null,
  });

  for (const employee of employees) {
    await processEmployeeAttendance({ employee, date: targetDate, source: "auto_close" });
  }

  return employees.length;
};

const startAttendanceClosingJob = () => {
  if (cronStarted || process.env.DISABLE_ATTENDANCE_CRON === "true") {
    return;
  }

  cronStarted = true;

  try {
    const cron = require("node-cron");
    cron.schedule(process.env.ATTENDANCE_CLOSING_CRON || "30 23 * * *", async () => {
      try {
        const count = await processAttendanceForAllCompanies();
        console.log(`Attendance closing job processed ${count} employees.`);
      } catch (error) {
        console.error("Attendance closing job failed:", error);
      }
    });
    console.log("Attendance closing cron registered.");
  } catch (error) {
    const runWithFallbackTimer = async () => {
      try {
        const count = await processAttendanceForAllCompanies();
        console.log(`Attendance closing fallback processed ${count} employees.`);
      } catch (jobError) {
        console.error("Attendance closing fallback failed:", jobError);
      } finally {
        fallbackTimer = setTimeout(runWithFallbackTimer, 24 * 60 * 60 * 1000);
      }
    };

    const now = new Date();
    const firstRun = new Date(now);
    const [hour, minute] = String(process.env.ATTENDANCE_CLOSING_TIME || "23:30").split(":").map(Number);
    firstRun.setHours(hour || 23, minute || 30, 0, 0);
    if (firstRun <= now) firstRun.setDate(firstRun.getDate() + 1);

    fallbackTimer = setTimeout(runWithFallbackTimer, firstRun - now);
    if (fallbackTimer.unref) fallbackTimer.unref();
    console.log("Attendance closing fallback scheduler registered.");
  }
};

module.exports = {
  startAttendanceClosingJob,
  processAttendanceForAllCompanies,
};
