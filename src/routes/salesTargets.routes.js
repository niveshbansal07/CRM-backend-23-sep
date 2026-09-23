const express = require("express");
const mongoose = require("mongoose");
const ApiError = require("../utils/ApiError");
const ApiResponse = require("../utils/ApiResponse");
const { authenticate } = require("../middlewares/auth.middleware");
const { getAccessRole } = require("../utils/roleAccess");
const { getPolicy, savePolicy } = require("../services/salesPerformancePolicy.service");
const { listPlans, createPlan, getPlanDetail, saveAllocation, removeAllocation, previewPlan, transitionPlan, getOwnerOptions } = require("../services/salesTarget.service");
const {
  getPerformanceDashboard,
  createPlanRevision,
  listPlanRevisions,
  comparePlans,
  listAchievementEvents,
  listUnattributableEvents,
  listCaptureFailures,
  retryCaptureFailure,
  getLegacyOrderDiagnostic,
  previewLegacyOrder,
  createPerformanceExport,
} = require("../services/salesPerformanceReporting.service");

const router = express.Router();
router.use(authenticate);

const companyContext = (req) => {
  const role = getAccessRole(req.user);
  const own = req.user?.companyId?._id || req.user?.companyId;
  const requested = req.headers["x-company-id"] || req.query.companyId || req.body?.companyId;
  const companyId = role === "super_admin" ? requested : own;
  if (!companyId || !mongoose.Types.ObjectId.isValid(String(companyId))) throw new ApiError(400, role === "super_admin" ? "Super Admin must provide a valid company context" : "Company context is required");
  if (role !== "super_admin" && requested && String(requested) !== String(own)) throw new ApiError(403, "Cross-company target access denied");
  return companyId;
};
const ok = (res, message, data, status = 200) => res.status(status).json(new ApiResponse(status, message, data));

router.get("/policy", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales performance policy fetched", { policy: await getPolicy(companyId, req.user) }); } catch (e) { next(e); } });
router.put("/policy", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales performance policy saved", { policy: await savePolicy({ companyId, user: req.user, payload: req.body, req }) }); } catch (e) { next(e); } });
router.get("/dashboard", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target performance dashboard fetched", await getPerformanceDashboard({ companyId, user: req.user, filters: req.query })); } catch (e) { next(e); } });
router.get("/scorecard", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales scorecard fetched", await getPerformanceDashboard({ companyId, user: req.user, filters: req.query })); } catch (e) { next(e); } });
router.get("/achievement-events", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Achievement events fetched", await listAchievementEvents({ companyId, user: req.user, filters: req.query })); } catch (e) { next(e); } });
router.get("/unattributable", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Achievement data-quality events fetched", await listUnattributableEvents({ companyId, user: req.user, filters: req.query })); } catch (e) { next(e); } });
router.get("/achievement-failures", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Achievement capture failures fetched", { failures: await listCaptureFailures({ companyId, user: req.user, filters: req.query }) }); } catch (e) { next(e); } });
router.post("/achievement-failures/:id/retry", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Achievement capture retry completed", await retryCaptureFailure({ companyId, failureId: req.params.id, user: req.user, req })); } catch (e) { next(e); } });
router.get("/exports/:type", async (req, res, next) => { try { const companyId = companyContext(req); const result = await createPerformanceExport({ companyId, user: req.user, type: req.params.type, filters: req.query }); res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${result.filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`); return res.status(200).send(`\uFEFF${result.csv}`); } catch (e) { next(e); } });
router.get("/plans", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plans fetched", { plans: await listPlans({ companyId, user: req.user, filters: req.query }) }); } catch (e) { next(e); } });
router.post("/plans", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plan created", await createPlan({ companyId, user: req.user, payload: req.body, req }), 201); } catch (e) { next(e); } });
router.get("/plans/:planId", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plan fetched", await getPlanDetail({ companyId, planId: req.params.planId, user: req.user, includePerformance: req.query.performance === "true" })); } catch (e) { next(e); } });
router.get("/plans/:planId/tree", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target hierarchy performance tree fetched", await getPerformanceDashboard({ companyId, user: req.user, filters: { ...req.query, planId: req.params.planId } })); } catch (e) { next(e); } });
router.post("/plans/:planId/revisions", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target plan revision created", await createPlanRevision({ companyId, planId: req.params.planId, user: req.user, reason: req.body?.reason, req }), 201); } catch (e) { next(e); } });
router.get("/plans/:planId/revisions", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target plan revision history fetched", { revisions: await listPlanRevisions({ companyId, planId: req.params.planId, user: req.user }) }); } catch (e) { next(e); } });
router.get("/plans/:planId/comparison", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target plans compared", await comparePlans({ companyId, planId: req.params.planId, otherPlanId: req.query.otherPlanId, user: req.user })); } catch (e) { next(e); } });
router.get("/plans/:planId/compare/:otherPlanId", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target plans compared", await comparePlans({ companyId, planId: req.params.planId, otherPlanId: req.params.otherPlanId, user: req.user })); } catch (e) { next(e); } });
router.get("/plans/:planId/preview", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plan previewed", { preview: await previewPlan({ companyId, planId: req.params.planId, user: req.user }) }); } catch (e) { next(e); } });
router.get("/plans/:planId/owner-options", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Target owner options fetched", await getOwnerOptions({ companyId, planId: req.params.planId, parentAllocationId: req.query.parentAllocationId, user: req.user })); } catch (e) { next(e); } });
router.put("/plans/:planId/allocations", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target allocation saved", await saveAllocation({ companyId, planId: req.params.planId, user: req.user, payload: req.body, req })); } catch (e) { next(e); } });
router.delete("/plans/:planId/allocations/:allocationId", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target allocation removed", await removeAllocation({ companyId, planId: req.params.planId, allocationId: req.params.allocationId, user: req.user, req })); } catch (e) { next(e); } });
router.post("/plans/:planId/submit", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plan submitted", await transitionPlan({ companyId, planId: req.params.planId, user: req.user, action: "submit", req })); } catch (e) { next(e); } });
router.post("/plans/:planId/approve", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plan approved", await transitionPlan({ companyId, planId: req.params.planId, user: req.user, action: "approve", req })); } catch (e) { next(e); } });
router.post("/plans/:planId/reject", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Sales target plan rejected", await transitionPlan({ companyId, planId: req.params.planId, user: req.user, action: "reject", reason: req.body?.reason, req })); } catch (e) { next(e); } });
router.get("/legacy-diagnostic", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Legacy order diagnostic fetched", await getLegacyOrderDiagnostic({ companyId, user: req.user })); } catch (e) { next(e); } });
router.get("/legacy-diagnostic/:orderId/preview", async (req, res, next) => { try { const companyId = companyContext(req); ok(res, "Legacy reconciliation preview fetched", await previewLegacyOrder({ companyId, orderId: req.params.orderId, user: req.user })); } catch (e) { next(e); } });

module.exports = router;
