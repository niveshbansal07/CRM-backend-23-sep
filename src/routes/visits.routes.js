const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  VIEW_ROLES,
  START_ROLES,
  APPROVER_ROLES,
  startVisit,
  endVisit,
  getActiveVisit,
  cancelVisit,
  addVisitLocationPoint,
  listVisits,
  getVisitDetail,
  getVisitRoute,
  approveVisit,
} = require("../services/visit.service");
const { getTeamLiveLocations } = require("../services/salesReport.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
  const companyId = getCompanyId(req.user);
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

router.use(authenticate);
router.use(allowRoles(...VIEW_ROLES));

router.post("/start", allowRoles(...START_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const result = await startVisit(req.user._id, companyId, req.body, req.user);
    return res.status(201).json(new ApiResponse(201, result.message, { visit: result.visit }));
  } catch (error) {
    next(error);
  }
});

router.get("/active", allowRoles(...START_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visit = await getActiveVisit(req.user._id, companyId);
    return res.status(200).json(new ApiResponse(200, "Active visit fetched successfully", { visit }));
  } catch (error) {
    next(error);
  }
});

router.get("/my", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visits = await listVisits(companyId, { executiveId: req.user._id }, req.query, req.user);
    return res.status(200).json(new ApiResponse(200, "My visits fetched successfully", { visits }));
  } catch (error) {
    next(error);
  }
});

router.get("/team", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visits = await listVisits(companyId, {}, req.query, req.user);
    return res.status(200).json(new ApiResponse(200, "Team visits fetched successfully", { visits }));
  } catch (error) {
    next(error);
  }
});

router.get("/team/live", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const executives = await getTeamLiveLocations(req.user, companyId);
    return res.status(200).json(new ApiResponse(200, "Live team locations fetched successfully", { executives }));
  } catch (error) {
    next(error);
  }
});

router.get("/company", allowRoles("sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visits = await listVisits(companyId, {}, req.query, req.user);
    return res.status(200).json(new ApiResponse(200, "Company visits fetched successfully", { visits }));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/end", allowRoles(...START_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const result = await endVisit(req.params.id, req.user._id, companyId, req.body, req.user);
    return res.status(200).json(new ApiResponse(200, "Visit completed successfully", result));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/cancel", allowRoles(...START_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visit = await cancelVisit(req.params.id, req.user._id, companyId, req.body?.reason);
    return res.status(200).json(new ApiResponse(200, "Visit cancelled successfully", { visit }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/location", allowRoles(...START_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const locationPoint = await addVisitLocationPoint(req.params.id, req.user._id, companyId, req.body);
    return res.status(201).json(new ApiResponse(201, "Visit location recorded successfully", { locationPoint }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/route", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const route = await getVisitRoute(req.params.id, companyId, req.user);
    return res.status(200).json(new ApiResponse(200, "Visit route fetched successfully", { route }));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/approve", allowRoles(...APPROVER_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visit = await approveVisit(req.params.id, req.user._id, companyId, req.user);
    return res.status(200).json(new ApiResponse(200, "Visit approved successfully", { visit }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visit = await getVisitDetail(req.params.id, companyId, req.user);
    return res.status(200).json(new ApiResponse(200, "Visit fetched successfully", { visit }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
