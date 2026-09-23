const Lead = require("../models/Lead");
const Visit = require("../models/Visit");
const LeadType = require("../models/LeadType");
const Account = require("../models/Account");
const CrmMaster = require("../models/CrmMaster");
const ApiError = require("../utils/ApiError");
const { createFollowUp } = require("./followUp.service");
const { logActivity } = require("./activityLog.service");
const {
  andFilters,
  resolveSalesVisibilityContext,
  buildLeadVisibilityFilter,
  assertEmployeeWithinVisibility,
  assertAccountWithinVisibility,
} = require("./salesVisibility.service");

const READ_ROLES = ["company_admin", "sub_admin", "sales_head", "sales_manager", "sales_executive", "sales"];
const WRITE_ROLES = READ_ROLES;
const DEALER_LEAD_TYPE_CODE = "dealer_lead";

const normalizeCode = (value) => String(value || "").trim().toLowerCase();
const isDealerLeadType = (leadType) => normalizeCode(leadType?.code) === DEALER_LEAD_TYPE_CODE;

const assertCompanyId = (companyId) => {
  if (!companyId) throw new ApiError(400, "Company context is required");
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const calculateCreationDurationSeconds = (startedAt, submittedAt, fallback = 0) => {
  const start = toDateOrNull(startedAt);
  const end = toDateOrNull(submittedAt) || new Date();
  if (!start) return Math.max(0, Number(fallback) || 0);
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
};

const normalizeLeadPhoto = (photo, source) => {
  if (!photo) return null;
  if (typeof photo === "string") {
    return { url: photo, source, capturedAt: new Date() };
  }
  return {
    url: photo.url || photo.dataUrl || "",
    name: photo.name || "",
    mimeType: photo.mimeType || photo.type || "",
    capturedAt: toDateOrNull(photo.capturedAt) || new Date(),
    source: photo.source || source,
  };
};

const normalizeLocationDetails = (payload = {}) => {
  const details = payload.locationDetails || {};
  const latitude = payload.creationLatitude ?? payload.latitude ?? details.latitude ?? null;
  const longitude = payload.creationLongitude ?? payload.longitude ?? details.longitude ?? null;
  const accuracy = payload.locationAccuracy ?? payload.accuracy ?? details.accuracy ?? null;
  if (!details && latitude === null && longitude === null) return null;
  return {
    latitude,
    longitude,
    accuracy,
    local: details.local || payload.local || "",
    city: details.city || payload.city || "",
    district: details.district || payload.district || "",
    state: details.state || payload.state || "",
    pincode: details.pincode || payload.pincode || "",
    country: details.country || payload.country || "",
    formattedAddress: details.formattedAddress || payload.formattedAddress || payload.address || "",
    googlePlaceId: details.googlePlaceId || payload.googlePlaceId || "",
    provider: details.provider || "",
    resolvedAt: toDateOrNull(details.resolvedAt) || null,
  };
};

const normalizeLeadPayload = (payload = {}, user) => {
  const assignedTo = payload.assignedTo || user?._id || null;
  const sourceMasterId = payload.sourceMasterId || payload.leadSource || null;
  const priorityMasterId = payload.priorityMasterId || payload.leadPriority || null;
  const creationStartedAt = toDateOrNull(payload.creationStartedAt);
  const creationSubmittedAt = toDateOrNull(payload.creationSubmittedAt) || new Date();
  const locationDetails = normalizeLocationDetails(payload);
  return {
    name: payload.name || [payload.firstName, payload.lastName].filter(Boolean).join(" ") || payload.companyName || "Untitled Lead",
    firstName: payload.firstName || "",
    lastName: payload.lastName || "",
    companyName: payload.companyName || "",
    contact: payload.contact || payload.phone || payload.email || "",
    email: payload.email || "",
    phone: payload.phone || "",
    status: payload.status || payload.defaultStatusCode || "new",
    source: payload.source || "Other",
    priority: payload.priority || "warm",
    assignedTo,
    reportingManagerId: payload.reportingManagerId || user?.reportingManagerId || user?.managerId || null,
    salesHeadId: payload.salesHeadId || null,
    departmentId: payload.departmentId || user?.departmentId || null,
    leadTypeId: payload.leadTypeId || null,
    sourceVisitId: payload.sourceVisitId || null,
    creationStartedAt,
    creationSubmittedAt,
    creationDurationSeconds: calculateCreationDurationSeconds(
      creationStartedAt,
      creationSubmittedAt,
      payload.creationDurationSeconds
    ),
    linkedDistributorId: payload.linkedDistributorId || null,
    linkedDealerId: payload.linkedDealerId || null,
    linkedAccountId: payload.linkedAccountId || null,
    sourceMasterId,
    priorityMasterId,
    creationLatitude: payload.creationLatitude ?? payload.latitude ?? null,
    creationLongitude: payload.creationLongitude ?? payload.longitude ?? null,
    locationAccuracy: payload.locationAccuracy ?? payload.accuracy ?? null,
    locationDetails,
    locationCapturedAt:
      payload.locationCapturedAt ||
      (payload.latitude || payload.creationLatitude || payload.longitude || payload.creationLongitude ? new Date() : null),
    productInterested: payload.productInterested || "",
    productsOfInterest: Array.isArray(payload.productsOfInterest) ? payload.productsOfInterest : [],
    salesExecutiveSelfie: normalizeLeadPhoto(payload.salesExecutiveSelfie, "front_camera_selfie"),
    shopPhoto: normalizeLeadPhoto(payload.shopPhoto, "back_camera_shop"),
    requirements: payload.requirements || "",
    gstNumber: payload.gstNumber || "",
    notes: payload.notes || "",
    city: payload.city || locationDetails?.city || locationDetails?.local || "",
    address: payload.address || locationDetails?.formattedAddress || "",
    nextAction: payload.nextAction || "",
    nextActionAt: payload.nextActionAt || null,
    customValues: payload.customValues || {},
  };
};

const requireAccount = async (companyId, accountId, message) => {
  if (!accountId) return null;
  const account = await Account.findOne({ _id: accountId, companyId, deletedAt: null }).select("_id").lean();
  if (!account) throw new ApiError(400, message);
  return account;
};

const requireDistributorAccount = async (companyId, accountId) => {
  if (!accountId) return null;
  const account = await Account.findOne({
    _id: accountId,
    companyId,
    deletedAt: null,
    status: { $ne: "inactive" },
  })
    .populate("accountTypeId", "code module type isActive")
    .lean();

  if (!account) throw new ApiError(400, "Selected Distributor is no longer available");
  const type = account.accountTypeId;
  if (
    !type ||
    type.module !== "account" ||
    type.type !== "account_type" ||
    type.isActive === false ||
    normalizeCode(type.code) !== "distributor"
  ) {
    throw new ApiError(400, "Selected account is not a Distributor");
  }
  return account;
};

const validateMaster = async (companyId, id, module, type, message) => {
  if (!id) return null;
  const master = await CrmMaster.findOne({ _id: id, companyId, module, type, isActive: true }).select("_id name code").lean();
  if (!master) throw new ApiError(400, message);
  return master;
};

const validateLeadCreatePayload = async (companyId, payload = {}, user = {}) => {
  let leadType = null;
  if (payload.leadTypeId) {
    leadType = await LeadType.findOne({ _id: payload.leadTypeId, companyId, isActive: true }).lean();
    if (!leadType) throw new ApiError(400, "Invalid lead type");

    if (!isDealerLeadType(leadType) && leadType.requiresDealerLink && !payload.linkedDealerId) {
      throw new ApiError(400, "This lead type requires a dealer to be linked");
    }
    if (leadType.requiresCompanyName && !String(payload.companyName || "").trim()) {
      throw new ApiError(400, "This lead type requires a company name");
    }
    if (leadType.requiresGSTNumber && !String(payload.gstNumber || "").trim()) {
      throw new ApiError(400, "This lead type requires a GST number");
    }
  }

  if (!isDealerLeadType(leadType) && payload.linkedDistributorId) {
    throw new ApiError(400, "Distributor linking is only available for Dealer leads");
  }

  if (!payload.salesExecutiveSelfie?.url && !payload.salesExecutiveSelfie?.dataUrl && typeof payload.salesExecutiveSelfie !== "string") {
    throw new ApiError(400, "Sales executive selfie is required");
  }
  if (!payload.shopPhoto?.url && !payload.shopPhoto?.dataUrl && typeof payload.shopPhoto !== "string") {
    throw new ApiError(400, "Shop photo is required");
  }
  if (["sales_executive", "sales"].includes(getActorRole(user)) && (!payload.creationLatitude || !payload.creationLongitude)) {
    throw new ApiError(400, "GPS location is required while creating a lead");
  }
  if (["sales_executive", "sales"].includes(getActorRole(user)) && !String(payload.locationDetails?.formattedAddress || "").trim()) {
    throw new ApiError(400, "Google Maps resolved address is required while creating a lead");
  }

  await Promise.all([
    requireAccount(companyId, payload.linkedDealerId, "Invalid linked dealer"),
    isDealerLeadType(leadType)
      ? requireDistributorAccount(companyId, payload.linkedDistributorId)
      : Promise.resolve(null),
    requireAccount(companyId, payload.linkedAccountId, "Invalid linked account"),
    validateMaster(companyId, payload.sourceMasterId || payload.leadSource, "lead", "lead_source", "Invalid lead source"),
    validateMaster(companyId, payload.priorityMasterId || payload.leadPriority, "lead", "lead_priority", "Invalid lead priority"),
  ]);

  return { leadType };
};

const getActorRole = (user = {}) => user.accessRole || user.systemRole || user.role || "";

const getAssigneeForSalesAssignment = async (companyId, assigneeId, user = {}) => {
  if (!assigneeId) throw new ApiError(400, "assignedTo is required");
  const role = getActorRole(user);
  if (!["company_admin", "sub_admin", "sales_head", "sales_manager"].includes(role)) {
    throw new ApiError(403, "Only sales managers, sales heads, and admins can assign leads or customers");
  }

  const context = await resolveSalesVisibilityContext({ user, companyId });
  return assertEmployeeWithinVisibility({ context, employeeId: assigneeId, companyId });
};

const resolveAccountTypeId = async (companyId, code) => {
  const normalizedCode = String(code || "").trim().toUpperCase();
  const accountType = await CrmMaster.findOne({
    companyId,
    module: "account",
    type: "account_type",
    $or: [
      { code: normalizedCode },
      { normalizedName: normalizeCode(code).replace(/_/g, " ") },
    ],
    isActive: true,
  })
    .select("_id")
    .lean();
  return accountType?._id || null;
};

const createLead = async (companyId, payload, user) => {
  assertCompanyId(companyId);
  const { leadType } = await validateLeadCreatePayload(companyId, payload, user);
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const targetAssignee = payload.assignedTo || user?._id;
  if (targetAssignee) {
    if (["sales_executive", "sales"].includes(getActorRole(user)) && String(targetAssignee) !== String(user?._id)) {
      throw new ApiError(403, "Field Sales employees can create Leads only for themselves");
    }
    if (
      !["sales_executive", "sales"].includes(getActorRole(user)) &&
      String(targetAssignee) !== String(user?._id)
    ) {
      await assertEmployeeWithinVisibility({ context: visibility, employeeId: targetAssignee, companyId });
    }
  }
  for (const accountId of [payload.linkedDistributorId, payload.linkedDealerId, payload.linkedAccountId].filter(Boolean)) {
    await assertAccountWithinVisibility({ context: visibility, accountId, companyId });
  }

  let sourceVisit = null;
  if (payload.sourceVisitId) {
    sourceVisit = await Visit.findOne({
      _id: payload.sourceVisitId,
      companyId,
      executiveId: user?._id,
    });
    if (!sourceVisit) {
      throw new ApiError(404, "Source visit not found for this executive and company");
    }
  }

  const data = normalizeLeadPayload(
    {
      ...payload,
      defaultStatusCode: payload.defaultStatusCode || leadType?.defaultStatusCode,
    },
    user
  );
  const lead = await Lead.create({
    ...data,
    companyId,
    createdBy: user?._id || null,
    updatedBy: user?._id || null,
  });

  try {
    await logActivity({
      companyId,
      entityType: "lead",
      entityId: lead._id,
      activityType: "lead_created",
      performedBy: user?._id || null,
      title: `Lead created: ${lead.name}${leadType?.name ? ` (${leadType.name})` : ""}`,
      metadata: { leadTypeId: lead.leadTypeId || null },
    });

    const scheduleDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await createFollowUp({
      leadId: lead._id,
      followUpType: "call",
      scheduledAt: scheduleDate,
      title: `Initial follow-up call with ${lead.name}`,
      notes: `First contact after lead creation. Lead source: ${lead.source || "Other"}`,
      priority: "normal",
      source: "lead_create",
    }, user?._id || lead.assignedTo, companyId);
  } catch (error) {
    console.error("Lead post-create follow-up setup failed:", error);
  }

  if (sourceVisit) {
    await Visit.findByIdAndUpdate(sourceVisit._id, {
      $set: {
        leadCreatedId: lead._id,
        updatedBy: user?._id || null,
      },
    });
  }

  return { lead };
};

const listLeads = async (companyId, user, filters = {}) => {
  assertCompanyId(companyId);
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const query = andFilters(
    { companyId, deletedAt: null },
    buildLeadVisibilityFilter(visibility, filters)
  );
  if (filters.includeConverted !== true && filters.includeConverted !== "true") {
    query.convertedAt = null;
  }
  if (filters.scope === "own") {
    query.$or = [{ assignedTo: user?._id }, { createdBy: user?._id }];
  }
  // assignedTo is already clamped by the authoritative visibility filter.
  if (filters.status) query.status = filters.status;
  if (filters.leadTypeId) query.leadTypeId = filters.leadTypeId;
  if (filters.search || filters.q) {
    const search = String(filters.search || filters.q).trim();
    if (search) {
      query.$and = query.$and || [];
      query.$and.push({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { firstName: { $regex: search, $options: "i" } },
          { lastName: { $regex: search, $options: "i" } },
          { companyName: { $regex: search, $options: "i" } },
          { phone: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { city: { $regex: search, $options: "i" } },
        ],
      });
    }
  }
  return Lead.find(query)
    .populate("assignedTo", "fullName email role")
    .populate("leadTypeId", "name code")
    .sort({ createdAt: -1 })
    .lean();
};

const getLeadById = async (companyId, leadId, user = null) => {
  assertCompanyId(companyId);
  const visibilityFilter = user
    ? buildLeadVisibilityFilter(await resolveSalesVisibilityContext({ user, companyId }))
    : {};
  const lead = await Lead.findOne(andFilters(
    { _id: leadId, companyId, deletedAt: null },
    visibilityFilter
  ))
    .populate("assignedTo", "fullName email role")
    .populate("leadTypeId", "name code")
    .populate("linkedDealerId", "name city")
    .populate("linkedDistributorId", "name city")
    .lean();
  if (!lead) throw new ApiError(404, "Lead not found");
  return lead;
};

const convertLeadToCustomer = async (companyId, leadId, payload = {}, user) => {
  assertCompanyId(companyId);

  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  if (payload.assignedTo && String(payload.assignedTo) !== String(user?._id)) {
    if (["sales_executive", "sales"].includes(getActorRole(user))) {
      throw new ApiError(403, "Field Sales employees cannot convert a Lead for another employee");
    }
    await assertEmployeeWithinVisibility({
      context: visibility,
      employeeId: payload.assignedTo,
      companyId,
    });
  }
  const lead = await Lead.findOne(andFilters(
    { _id: leadId, companyId, deletedAt: null },
    buildLeadVisibilityFilter(visibility)
  ));
  if (!lead) throw new ApiError(404, "Lead not found");

  if (lead.convertedAt && lead.convertedAccountId) {
    const existingCustomer = await Account.findOne({ _id: lead.convertedAccountId, companyId, deletedAt: null }).lean();
    return { lead, customer: existingCustomer, alreadyConverted: true };
  }

  const now = new Date();
  const leadType = lead.leadTypeId
    ? await LeadType.findOne({ _id: lead.leadTypeId, companyId }).select("_id code").lean()
    : null;
  const dealerLead = isDealerLeadType(leadType);
  const accountType = dealerLead ? "dealer" : "customer";
  const accountTypeId = await resolveAccountTypeId(companyId, dealerLead ? "DEALER" : "CUSTOMER");
  const distributor = dealerLead && lead.linkedDistributorId
    ? await requireDistributorAccount(companyId, lead.linkedDistributorId)
    : null;
  if (distributor) {
    await assertAccountWithinVisibility({
      context: visibility,
      accountId: distributor._id,
      companyId,
    });
  }
  for (const linkedParentId of [lead.linkedDealerId, !dealerLead ? lead.linkedDistributorId : null].filter(Boolean)) {
    await assertAccountWithinVisibility({
      context: visibility,
      accountId: linkedParentId,
      companyId,
    });
  }
  const existingAccountId = payload.accountId || lead.linkedAccountId || null;
  let customer = null;

  if (existingAccountId) {
    await assertAccountWithinVisibility({ context: visibility, accountId: existingAccountId, companyId });
    customer = await Account.findOne({ _id: existingAccountId, companyId, deletedAt: null });
    if (!customer) throw new ApiError(400, "Invalid customer account");
    customer.status = dealerLead ? "partner" : "customer";
    customer.accountType = accountType;
    customer.accountTypeId = accountTypeId || customer.accountTypeId || null;
    if (dealerLead) {
      customer.parentAccountId = distributor?._id || null;
      customer.parentRelationshipType = distributor ? "distributor" : null;
    }
    customer.sourceLeadId = lead._id;
    customer.convertedFromLeadId = lead._id;
    customer.convertedAt = customer.convertedAt || now;
    customer.updatedBy = user?._id || null;
    await customer.save();
  } else {
    customer = await Account.create({
      companyId,
      name:
        payload.customerName ||
        lead.companyName ||
        lead.name ||
        [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
        (dealerLead ? "Converted Dealer" : "Converted Customer"),
      accountType,
      accountTypeId,
      status: dealerLead ? "partner" : "customer",
      phone: lead.phone || lead.contact || "",
      email: lead.email || "",
      ownerName: lead.name || [lead.firstName, lead.lastName].filter(Boolean).join(" "),
      gstNumber: lead.gstNumber || "",
      address: lead.address || lead.locationDetails?.formattedAddress || "",
      city: lead.city || lead.locationDetails?.city || lead.locationDetails?.local || "",
      latitude: lead.creationLatitude ?? lead.geoLocation?.lat ?? null,
      longitude: lead.creationLongitude ?? lead.geoLocation?.lng ?? null,
      assignedTo: payload.assignedTo || lead.assignedTo || user?._id || null,
      reportingManagerId: lead.reportingManagerId || user?.reportingManagerId || null,
      parentAccountId: dealerLead
        ? distributor?._id || null
        : lead.linkedDealerId || lead.linkedDistributorId || null,
      parentRelationshipType: dealerLead
        ? (distributor ? "distributor" : null)
        : lead.linkedDealerId ? "dealer" : lead.linkedDistributorId ? "distributor" : null,
      source: "Lead Conversion",
      sourceLeadId: lead._id,
      convertedFromLeadId: lead._id,
      convertedAt: now,
      createdBy: user?._id || null,
      updatedBy: user?._id || null,
    });
  }

  lead.status = "converted";
  lead.convertedAt = now;
  lead.convertedBy = user?._id || null;
  lead.convertedAccountId = customer._id;
  lead.linkedAccountId = customer._id;
  lead.updatedBy = user?._id || null;
  await lead.save();

  return { lead, customer, alreadyConverted: false };
};

const assignLead = async (companyId, leadId, assigneeId, user) => {
  assertCompanyId(companyId);
  const visibility = await resolveSalesVisibilityContext({ user, companyId });
  const assignee = await getAssigneeForSalesAssignment(companyId, assigneeId, user);
  const lead = await Lead.findOne(andFilters(
    { _id: leadId, companyId, deletedAt: null },
    buildLeadVisibilityFilter(visibility)
  ));
  if (!lead) throw new ApiError(404, "Lead not found");

  lead.assignedTo = assignee._id;
  lead.reportingManagerId = assignee.reportingManagerId || null;
  lead.updatedBy = user?._id || null;
  await lead.save();

  await logActivity({
    companyId,
    entityType: "lead",
    entityId: lead._id,
    activityType: "lead_assigned",
    performedBy: user?._id || null,
    title: `Lead assigned to ${assignee.fullName || assignee.email || "sales executive"}`,
    metadata: { assignedTo: assignee._id },
  }).catch((error) => console.error("Lead assignment activity failed:", error));

  return Lead.findById(lead._id)
    .populate("assignedTo", "fullName email role")
    .populate("leadTypeId", "name code")
    .lean();
};

module.exports = {
  Lead,
  READ_ROLES,
  WRITE_ROLES,
  createLead,
  listLeads,
  getLeadById,
  convertLeadToCustomer,
  assignLead,
  getAssigneeForSalesAssignment,
  isDealerLeadType,
  requireDistributorAccount,
  validateLeadCreatePayload,
};
