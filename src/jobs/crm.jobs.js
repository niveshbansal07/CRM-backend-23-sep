const { autoCloseStaleVisits } = require("../services/visit.service");
const {
  markOverdueFollowUps,
  sendFollowUpReminders,
  escalateStaleFollowUps,
} = require("../services/followUp.service");

let jobStarted = false;
let fallbackTimer = null;
let followUpFallbackTimer = null;

const runAutoClose = async () => {
  try {
    const count = await autoCloseStaleVisits();
    if (count > 0) {
      console.log(`CRM stale visit job auto-closed ${count} visits.`);
    }
  } catch (error) {
    console.error("CRM stale visit job failed:", error);
  }
};

const runMarkOverdueFollowUps = async () => {
  try {
    const count = await markOverdueFollowUps();
    if (count > 0) console.log(`CRM follow-up overdue job marked ${count} follow-ups.`);
  } catch (error) {
    console.error("CRM follow-up overdue job failed:", error);
  }
};

const runFollowUpReminders = async () => {
  try {
    const count = await sendFollowUpReminders();
    if (count > 0) console.log(`CRM follow-up reminder job sent ${count} reminders.`);
  } catch (error) {
    console.error("CRM follow-up reminder job failed:", error);
  }
};

const runEscalateStaleFollowUps = async () => {
  try {
    const count = await escalateStaleFollowUps();
    if (count > 0) console.log(`CRM follow-up escalation job escalated ${count} follow-ups.`);
  } catch (error) {
    console.error("CRM follow-up escalation job failed:", error);
  }
};

const startCrmJobs = () => {
  if (jobStarted || process.env.DISABLE_CRM_JOBS === "true") return;
  jobStarted = true;

  try {
    const cron = require("node-cron");
    cron.schedule(process.env.CRM_STALE_VISIT_CRON || "0 * * * *", runAutoClose);
    cron.schedule(process.env.CRM_FOLLOWUP_OVERDUE_CRON || "*/30 * * * *", runMarkOverdueFollowUps);
    cron.schedule(process.env.CRM_FOLLOWUP_REMINDER_CRON || "0 * * * *", runFollowUpReminders);
    cron.schedule(process.env.CRM_FOLLOWUP_ESCALATION_CRON || "0 9 * * *", runEscalateStaleFollowUps);
    console.log("CRM stale visit cron registered.");
    console.log("CRM follow-up cron jobs registered.");
  } catch (error) {
    const intervalMs = Number(process.env.CRM_STALE_VISIT_INTERVAL_MS) || 60 * 60 * 1000;
    fallbackTimer = setInterval(runAutoClose, intervalMs);
    if (fallbackTimer.unref) fallbackTimer.unref();
    const followUpIntervalMs = Number(process.env.CRM_FOLLOWUP_INTERVAL_MS) || 30 * 60 * 1000;
    followUpFallbackTimer = setInterval(async () => {
      await runMarkOverdueFollowUps();
      await runFollowUpReminders();
      await runEscalateStaleFollowUps();
    }, followUpIntervalMs);
    if (followUpFallbackTimer.unref) followUpFallbackTimer.unref();
    console.log("CRM stale visit fallback scheduler registered.");
    console.log("CRM follow-up fallback scheduler registered.");
  }
};

module.exports = {
  startCrmJobs,
  runAutoClose,
  runMarkOverdueFollowUps,
  runFollowUpReminders,
  runEscalateStaleFollowUps,
};
