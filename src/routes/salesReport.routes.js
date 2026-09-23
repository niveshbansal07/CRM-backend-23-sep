const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  REPORT_ROLES,
  getDateRange,
  scopeExecutiveIds,
  getExecutiveDashboard,
  getManagerDashboard,
  getHeadDashboard,
  getVisitsReport,
  getVisitDurationReport,
  getVisitTypeDistribution,
  getDealerCoverage,
  getDistributorRevenue,
  getProductPerformance,
  getLeadConversion,
  getMissedFollowups,
  getDiscountSummary,
  getSalesActivityTeam,
  getSalesUserActivity,
} = require("../services/salesReport.service");
const {
  resolveSalesVisibilityContext,
  resolveAccessibleAccountScope,
} = require("../services/salesVisibility.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
  const companyId = getCompanyId(req.user);
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

router.use(authenticate);
router.use(allowRoles(...REPORT_ROLES));

router.get("/executive-dashboard", allowRoles("sales_executive", "sales"), async (req, res, next) => {
  try {
    const data = await getExecutiveDashboard(req.user._id, requireCompanyContext(req), req.query);
    res.status(200).json(new ApiResponse(200, "Executive dashboard fetched successfully", data));
  } catch (error) {
    next(error);
  }
});

router.get("/manager-dashboard", allowRoles("sales_manager"), async (req, res, next) => {
  try {
    const data = await getManagerDashboard(req.user, requireCompanyContext(req), req.query);
    res.status(200).json(new ApiResponse(200, "Manager dashboard fetched successfully", data));
  } catch (error) {
    next(error);
  }
});

router.get("/head-dashboard", allowRoles("sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const data = await getHeadDashboard(req.user._id, requireCompanyContext(req), req.query);
    res.status(200).json(new ApiResponse(200, "Head dashboard fetched successfully", data));
  } catch (error) {
    next(error);
  }
});

router.get("/activity/team", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const data = await getSalesActivityTeam(req.user, requireCompanyContext(req), req.query);
    res.status(200).json(new ApiResponse(200, "Sales activity team fetched successfully", data));
  } catch (error) {
    next(error);
  }
});

router.get("/activity/users/:userId", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const data = await getSalesUserActivity(req.user, requireCompanyContext(req), req.params.userId, req.query);
    res.status(200).json(new ApiResponse(200, "Sales user activity fetched successfully", data));
  } catch (error) {
    next(error);
  }
});

router.get("/visits", async (req, res, next) => {
  try {
    const visits = await getVisitsReport(requireCompanyContext(req), req.user, req.query);
    res.status(200).json(new ApiResponse(200, "Visit report fetched successfully", { visits }));
  } catch (error) {
    next(error);
  }
});

router.get("/visit-duration", async (req, res, next) => {
  try {
    const rows = await getVisitDurationReport(requireCompanyContext(req), req.user, req.query);
    res.status(200).json(new ApiResponse(200, "Visit duration report fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

router.get("/visit-type-distribution", async (req, res, next) => {
  try {
    const rows = await getVisitTypeDistribution(requireCompanyContext(req), req.user, req.query);
    res.status(200).json(new ApiResponse(200, "Visit type distribution fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

router.get("/dealer-coverage", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const visibility = await resolveSalesVisibilityContext({ user: req.user, companyId });
    const executiveIds = req.query.executiveId
      ? visibility.accessibleEmployeeIds.some((id) => String(id) === String(req.query.executiveId))
        ? [req.query.executiveId]
        : []
      : visibility.accessibleEmployeeIds;
    const accountScope = await resolveAccessibleAccountScope(visibility);
    const data = await getDealerCoverage(companyId, {
      range: getDateRange(req.query),
      executiveIds,
      accountIds: accountScope.companyWide ? null : accountScope.accountIds,
    });
    res.status(200).json(new ApiResponse(200, "Dealer coverage report fetched successfully", data));
  } catch (error) {
    next(error);
  }
});

router.get("/distributor-revenue", allowRoles("sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const executiveIds = await scopeExecutiveIds(req.user, companyId, req.query.executiveId);
    const rows = await getDistributorRevenue(companyId, { range: getDateRange(req.query), executiveIds });
    res.status(200).json(new ApiResponse(200, "Distributor revenue report fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

router.get("/product-performance", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const executiveIds = await scopeExecutiveIds(req.user, companyId, req.query.executiveId);
    const rows = await getProductPerformance(companyId, { range: getDateRange(req.query), executiveIds });
    res.status(200).json(new ApiResponse(200, "Product performance report fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

router.get("/lead-conversion", async (req, res, next) => {
  try {
    const rows = await getLeadConversion(requireCompanyContext(req), req.user, req.query);
    res.status(200).json(new ApiResponse(200, "Lead conversion report fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

router.get("/missed-followups", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    const executiveIds = await scopeExecutiveIds(req.user, companyId, req.query.executiveId);
    const rows = await getMissedFollowups(companyId, { executiveIds });
    res.status(200).json(new ApiResponse(200, "Missed follow-ups report fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

router.get("/discount-summary", allowRoles("sales_manager", "sales_head", "company_admin", "sub_admin"), async (req, res, next) => {
  try {
    const rows = await getDiscountSummary(requireCompanyContext(req), req.user, req.query);
    res.status(200).json(new ApiResponse(200, "Discount summary report fetched successfully", { rows }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
