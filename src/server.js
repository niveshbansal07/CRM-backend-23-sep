console.log("1. ENV Loaded");

const app = require("./app");
const connectDB = require("./config/db");
const { ensureDefaultSuperAdmin } = require("./services/auth.service");
const { startAttendanceClosingJob } = require("./jobs/attendanceClosing.job");
const { startCrmJobs } = require("./jobs/crm.jobs");
const env = require("./config/env");

const startServer = async () => {
  try {
    console.log("2. Connecting DB");
    await connectDB();

    console.log("3. Ensuring Super Admin");
    await ensureDefaultSuperAdmin();

    console.log("4. Starting Attendance Job");
    startAttendanceClosingJob();

    console.log("4b. Starting CRM Jobs");
    startCrmJobs();

    app.listen(env.port, () => {
      console.log(`5. Server running on port ${env.port}`);
    });
  } catch (error) {
    console.error("SERVER START ERROR:");
    console.error(error);
    process.exit(1);
  }
};

startServer();
