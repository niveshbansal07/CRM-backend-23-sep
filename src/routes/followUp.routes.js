const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  SALES_ROLES,
  MANAGER_ROLES,
  createFollowUp,
  completeFollowUp,
  rescheduleFollowUp,
  skipFollowUp,
  getMyFollowUps,
  getTeamFollowUps,
  getTodaysFollowUps,
  getFollowUpById,
} = require("../services/followUp.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
  const companyId = getCompanyId(req.user);
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

router.use(authenticate);
router.use(allowRoles(...SALES_ROLES));

router.post("/", async (req, res, next) => {
  try {
    const followUp = await createFollowUp(req.body, req.user._id, requireCompanyContext(req), req.user);
    res.status(201).json(new ApiResponse(201, "Follow-up created successfully", { followUp }));
  } catch (error) {
    next(error);
  }
});

router.get("/my", async (req, res, next) => {
  try {
    const result = await getMyFollowUps(req.user._id, requireCompanyContext(req), req.query);
    res.status(200).json(new ApiResponse(200, "My follow-ups fetched successfully", result));
  } catch (error) {
    next(error);
  }
});

router.get("/today", async (req, res, next) => {
  try {
    const followUps = await getTodaysFollowUps(req.user._id, requireCompanyContext(req));
    res.status(200).json(new ApiResponse(200, "Today's follow-ups fetched successfully", { followUps }));
  } catch (error) {
    next(error);
  }
});

router.get("/team", allowRoles(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const result = await getTeamFollowUps(req.user._id, requireCompanyContext(req), req.query, req.user);
    res.status(200).json(new ApiResponse(200, "Team follow-ups fetched successfully", result));
  } catch (error) {
    next(error);
  }
});

router.get("/overdue", allowRoles(...MANAGER_ROLES), async (req, res, next) => {
  try {
    const result = await getTeamFollowUps(req.user._id, requireCompanyContext(req), { ...req.query, isOverdue: true, status: "pending" }, req.user);
    res.status(200).json(new ApiResponse(200, "Overdue follow-ups fetched successfully", result));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const followUp = await getFollowUpById(req.params.id, requireCompanyContext(req), req.user);
    res.status(200).json(new ApiResponse(200, "Follow-up fetched successfully", { followUp }));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/complete", async (req, res, next) => {
  try {
    const result = await completeFollowUp(req.params.id, req.user._id, requireCompanyContext(req), req.body, req.user);
    res.status(200).json(new ApiResponse(200, "Follow-up completed successfully", result));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/reschedule", async (req, res, next) => {
  try {
    const followUp = await rescheduleFollowUp(req.params.id, req.user._id, requireCompanyContext(req), req.body, req.user);
    res.status(200).json(new ApiResponse(200, "Follow-up rescheduled successfully", { followUp }));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/skip", async (req, res, next) => {
  try {
    const followUp = await skipFollowUp(req.params.id, req.user._id, requireCompanyContext(req), req.body?.reason, req.user);
    res.status(200).json(new ApiResponse(200, "Follow-up skipped successfully", { followUp }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
