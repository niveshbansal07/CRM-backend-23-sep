const express = require("express");
const ApiResponse = require("../utils/ApiResponse");
const ApiError = require("../utils/ApiError");
const { authenticate } = require("../middlewares/auth.middleware");
const { allowRoles } = require("../middlewares/role.middleware");
const {
  READ_ROLES,
  WRITE_ROLES,
  createLead,
  listLeads,
  getLeadById,
  convertLeadToCustomer,
  assignLead,
} = require("../services/lead.service");
const { createFollowUp, getFollowUpsForLead } = require("../services/followUp.service");
const { getLeadTimeline, logActivity } = require("../services/activityLog.service");

const router = express.Router();

const getCompanyId = (user) => user?.companyId?._id || user?.companyId || null;

const requireCompanyContext = (req) => {
  const companyId = getCompanyId(req.user);
  if (!companyId) throw new ApiError(400, "Company context is required");
  return companyId;
};

router.use(authenticate);
router.use(allowRoles(...READ_ROLES));

router.get("/", async (req, res, next) => {
  try {
    const leads = await listLeads(requireCompanyContext(req), req.user, req.query);
    return res.status(200).json(new ApiResponse(200, "Leads fetched successfully", { leads }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/timeline", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    await getLeadById(companyId, req.params.id, req.user);
    const result = await getLeadTimeline(req.params.id, companyId, req.query);
    return res.status(200).json(new ApiResponse(200, "Lead timeline fetched successfully", result));
  } catch (error) {
    next(error);
  }
});

router.get("/:id/followups", async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    await getLeadById(companyId, req.params.id, req.user);
    const followUps = await getFollowUpsForLead(req.params.id, companyId, req.query, req.user);
    return res.status(200).json(new ApiResponse(200, "Lead follow-ups fetched successfully", { followUps }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/followups", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const companyId = requireCompanyContext(req);
    await getLeadById(companyId, req.params.id, req.user);
    const followUp = await createFollowUp({ ...req.body, leadId: req.params.id }, req.user._id, companyId, req.user);
    return res.status(201).json(new ApiResponse(201, "Lead follow-up created successfully", { followUp }));
  } catch (error) {
    next(error);
  }
});

router.post("/:leadId/log-activity", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const allowedTypes = ["call_logged", "whatsapp_logged", "note_added", "email_logged"];
    const activityType = req.body?.activityType;
    if (!allowedTypes.includes(activityType)) {
      throw new ApiError(400, "Invalid activity type");
    }
    await getLeadById(requireCompanyContext(req), req.params.leadId, req.user);
    const activity = await logActivity({
      companyId: requireCompanyContext(req),
      entityType: "lead",
      entityId: req.params.leadId,
      activityType,
      performedBy: req.user._id,
      title: req.body?.title || "Lead activity logged",
      description: req.body?.description || "",
      metadata: req.body?.metadata || {},
    });
    return res.status(201).json(new ApiResponse(201, "Lead activity logged successfully", { activity }));
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const lead = await getLeadById(requireCompanyContext(req), req.params.id, req.user);
    return res.status(200).json(new ApiResponse(200, "Lead fetched successfully", { lead }));
  } catch (error) {
    next(error);
  }
});

router.post("/", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const result = await createLead(requireCompanyContext(req), req.body, req.user);
    return res.status(201).json(new ApiResponse(201, "Lead created successfully", result));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/convert", allowRoles(...WRITE_ROLES), async (req, res, next) => {
  try {
    const result = await convertLeadToCustomer(requireCompanyContext(req), req.params.id, req.body, req.user);
    return res.status(200).json(new ApiResponse(200, "Lead converted to customer successfully", result));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/assign", allowRoles("company_admin", "sub_admin", "sales_head", "sales_manager"), async (req, res, next) => {
  try {
    const lead = await assignLead(requireCompanyContext(req), req.params.id, req.body?.assignedTo, req.user);
    return res.status(200).json(new ApiResponse(200, "Lead assigned successfully", { lead }));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
