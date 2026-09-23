const mongoose = require("mongoose");
const app = require("../src/app");
const connectDB = require("../src/config/db");
const env = require("../src/config/env");
const { ensureDefaultSuperAdmin } = require("../src/services/auth.service");

const Company = require("../src/models/Company");
const User = require("../src/models/User");
const CrmMaster = require("../src/models/CrmMaster");
const LeadType = require("../src/models/LeadType");
const VisitType = require("../src/models/VisitType");
const Account = require("../src/models/Account");
const Product = require("../src/models/Product");
const ProductPriceHistory = require("../src/models/ProductPriceHistory");
const Visit = require("../src/models/Visit");
const VisitLocationPoint = require("../src/models/VisitLocationPoint");
const Order = require("../src/models/Order");
const OrderItem = require("../src/models/OrderItem");
const FollowUp = require("../src/models/FollowUp");
const ActivityLog = require("../src/models/ActivityLog");
const Notification = require("../src/models/Notification");
const RefreshToken = require("../src/models/RefreshToken");

const suffix = `${Date.now()}`;
const adminPassword = "123456";
const salesPassword = "123456";
let baseUrl = "";
let server;
let companyId = null;
const createdUserEmails = [];
const results = [];

const pass = (label, detail = "") => {
  results.push({ status: "PASS", label, detail });
  console.log(`PASS ${label}${detail ? ` - ${detail}` : ""}`);
};

const fail = (label, error) => {
  const message = error?.message || String(error);
  results.push({ status: "FAIL", label, detail: message });
  console.error(`FAIL ${label} - ${message}`);
};

const request = async (method, path, token, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(`${method} ${path} -> ${response.status}: ${payload?.message || "Request failed"}`);
  }
  return payload?.data ?? payload;
};

const expectRequestFailure = async (method, path, token, body, expectedStatus, expectedMessagePart = "") => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (response.status !== expectedStatus) {
    throw new Error(
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${payload?.message || "Request failed"}`
    );
  }
  if (expectedMessagePart && !String(payload?.message || "").includes(expectedMessagePart)) {
    throw new Error(
      `${method} ${path} expected message containing "${expectedMessagePart}", got "${payload?.message || ""}"`
    );
  }
  return payload;
};

const login = async (email, password) => {
  const data = await request("POST", "/api/auth/login", null, { email, password });
  return data.accessToken;
};

const cleanup = async () => {
  if (!companyId) return;
  await Promise.all([
    RefreshToken.deleteMany({ userId: { $in: await User.find({ companyId }).distinct("_id") } }),
    OrderItem.deleteMany({ companyId }),
    Notification.deleteMany({ companyId }),
    Order.deleteMany({ companyId }),
    FollowUp.deleteMany({ companyId }),
    ActivityLog.deleteMany({ companyId }),
    VisitLocationPoint.deleteMany({ companyId }),
    Visit.deleteMany({ companyId }),
    ProductPriceHistory.deleteMany({ companyId }),
    Product.deleteMany({ companyId }),
    Account.deleteMany({ companyId }),
    VisitType.deleteMany({ companyId }),
    LeadType.deleteMany({ companyId }),
    CrmMaster.deleteMany({ companyId }),
    User.deleteMany({ companyId }),
    Company.deleteOne({ _id: companyId }),
  ]);
};

const getOrCreateOutcome = async (adminToken) => {
  const existing = await request("GET", "/api/crm/masters?module=visit&type=visit_outcome", adminToken);
  const rows = existing.masters || [];
  if (rows[0]) return rows[0];

  const created = await request("POST", "/api/crm/masters", adminToken, {
    module: "visit",
    type: "visit_outcome",
    name: "Interested",
    code: `INTERESTED_${suffix}`,
    color: "#22C55E",
    sortOrder: 1,
  });
  return created.master;
};

const main = async () => {
  await connectDB();
  await ensureDefaultSuperAdmin();

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const superToken = await login(env.defaultSuperAdminEmail, env.defaultSuperAdminPassword);
  pass("Super admin login");

  const adminEmail = `phase8-admin-${suffix}@example.com`;
  createdUserEmails.push(adminEmail);
  const companyData = await request("POST", "/api/companies", superToken, {
    name: `Phase 8 Smoke ${suffix}`,
    domain: `phase8-${suffix}.test`,
    industry: "Distribution",
    plan: "pro",
    enabledModules: ["contacts", "deals", "leads", "reports", "tickets", "hrms"],
    adminName: "Phase 8 Admin",
    adminEmail,
    adminPassword,
  });
  companyId = companyData.company._id || companyData.company.id;
  pass("Create test company", String(companyId));

  const adminToken = await login(adminEmail, adminPassword);
  pass("Company admin login");

  const leadSources = await request("GET", "/api/crm/masters?module=lead&type=lead_source", adminToken);
  if ((leadSources.masters || []).length !== 12) {
    throw new Error(`Expected 12 lead source masters, got ${(leadSources.masters || []).length}`);
  }
  pass("Seeded lead source masters", "12 items");

  const systemLeadSource = leadSources.masters[0];
  await expectRequestFailure("DELETE", `/api/crm/masters/${systemLeadSource._id}`, adminToken, undefined, 403, "System masters cannot be deleted");
  pass("System master delete is blocked");

  const customMaster = await request("POST", "/api/crm/masters", adminToken, {
    module: "lead",
    type: "lead_source",
    name: `Smoke Custom Source ${suffix}`,
    code: `SMOKE_CUSTOM_SOURCE_${suffix}`,
    color: "#22C55E",
  });
  await expectRequestFailure("POST", "/api/crm/masters", adminToken, {
    module: "lead",
    type: "lead_source",
    name: `Smoke Custom Source ${suffix}`,
    code: `SMOKE_CUSTOM_SOURCE_DUP_${suffix}`,
  }, 400);
  pass("Duplicate master name rejected");
  await request("PATCH", `/api/crm/masters/${customMaster.master._id}/status`, adminToken, { isActive: false });
  const activeLeadSources = await request("GET", "/api/crm/masters?module=lead&type=lead_source&isActive=true", adminToken);
  if ((activeLeadSources.masters || []).some((master) => String(master._id) === String(customMaster.master._id))) {
    throw new Error("Deactivated master appeared in active list");
  }
  pass("Deactivated master hidden from active list");

  const seededLeadTypes = await request("GET", "/api/crm/setup/lead-types", adminToken);
  if ((seededLeadTypes.leadTypes || []).length !== 5) {
    throw new Error(`Expected 5 default lead types, got ${(seededLeadTypes.leadTypes || []).length}`);
  }
  const dealerLead = seededLeadTypes.leadTypes.find((type) => type.code === "dealer_lead");
  if (!dealerLead?.requiresDealerLink) throw new Error("Dealer Lead type does not require dealer link");
  pass("Seeded lead types validated", "5 defaults, Dealer Lead requires dealer");

  const seededVisitTypes = await request("GET", "/api/crm/setup/visit-types", adminToken);
  if ((seededVisitTypes.visitTypes || []).length !== 8) {
    throw new Error(`Expected 8 default visit types, got ${(seededVisitTypes.visitTypes || []).length}`);
  }
  const productDemo = seededVisitTypes.visitTypes.find((type) => type.code === "product_demo");
  if (!productDemo?.requiresPhoto) throw new Error("Product Demo visit type does not require photo");
  pass("Seeded visit types validated", "8 defaults, Product Demo requires photo");

  const managerEmail = `phase8-manager-${suffix}@example.com`;
  createdUserEmails.push(managerEmail);
  const managerData = await request("POST", "/api/auth/register", superToken, {
    fullName: "Phase 8 Sales Manager",
    email: managerEmail,
    password: salesPassword,
    role: "sales_manager",
    systemRole: "sales_manager",
    permissionScope: "team",
    companyId,
  });
  const managerUserId = managerData.user._id || managerData.user.id;
  const managerToken = await login(managerEmail, salesPassword);
  pass("Create sales manager", String(managerUserId));

  const headEmail = `phase8-head-${suffix}@example.com`;
  createdUserEmails.push(headEmail);
  const headData = await request("POST", "/api/auth/register", superToken, {
    fullName: "Phase 8 Sales Head",
    email: headEmail,
    password: salesPassword,
    role: "sales_head",
    systemRole: "sales_head",
    permissionScope: "company",
    companyId,
  });
  const headUserId = headData.user._id || headData.user.id;
  const headToken = await login(headEmail, salesPassword);
  pass("Create sales head", String(headUserId));

  const salesEmail = `phase8-sales-${suffix}@example.com`;
  createdUserEmails.push(salesEmail);
  const salesData = await request("POST", "/api/auth/register", superToken, {
    fullName: "Phase 8 Sales Executive",
    email: salesEmail,
    password: salesPassword,
    role: "sales_executive",
    systemRole: "sales_executive",
    permissionScope: "self",
    companyId,
    reportingManagerId: managerUserId,
  });
  const salesUserId = salesData.user._id || salesData.user.id;
  await User.updateOne({ _id: salesUserId }, { $set: { reportingManagerId: managerUserId } });
  if (!(salesData.user.customPermissions || []).includes("crm.leads.create")) {
    throw new Error("Sales executive default permissions do not include crm.leads.create");
  }
  pass("Create sales user", String(salesUserId));

  const salesToken = await login(salesEmail, salesPassword);
  pass("Sales user login");

  const leadType = await request("POST", "/api/crm/setup/lead-types", adminToken, {
    name: `Retail Lead ${suffix}`,
    code: `retail_lead_${suffix}`,
    expectedConversionDays: 15,
    requiresDistributorLink: true,
    requiresDealerLink: true,
    requiresLocationCapture: true,
    requiresProductInterest: true,
    requiresCompanyName: true,
    requiresGSTNumber: false,
    color: "#3B82F6",
  });
  pass("Create lead type", leadType.leadType?.code || leadType.leadType?.name);

  const visitType = await request("POST", "/api/crm/setup/visit-types", adminToken, {
    name: `Order Visit ${suffix}`,
    code: `order_visit_${suffix}`,
    allowedEntityTypes: ["Account"],
    expectedDurationMinutes: 15,
    requiresCheckInLocation: true,
    requiresCheckOutLocation: true,
    requiresOutcome: true,
    requiresProductDiscussion: true,
    requiresPhoto: false,
    requiresNextFollowUp: true,
    allowsOrderCreation: true,
    color: "#F97316",
  });
  const visitTypeDoc = visitType.visitType;
  pass("Create visit type", visitTypeDoc.code);

  const outcome = await getOrCreateOutcome(adminToken);
  pass("Load visit outcome master", outcome.name || outcome.code);

  const accountTypes = await request("GET", "/api/crm/masters?module=account&type=account_type", adminToken);
  const distributorType = accountTypes.masters.find((master) => master.code === "DISTRIBUTOR");
  const dealerType = accountTypes.masters.find((master) => master.code === "DEALER");
  const customerType = accountTypes.masters.find((master) => master.code === "CUSTOMER");
  if (!distributorType || !dealerType || !customerType) throw new Error("Required account type masters are missing");

  const distributorData = await request("POST", "/api/crm/accounts", adminToken, {
    name: `Phase 8 Distributor ${suffix}`,
    accountType: "distributor",
    accountTypeId: distributorType._id,
    status: "partner",
    phone: "9777777777",
    city: "Noida",
    assignedTo: salesUserId,
  });
  const distributor = distributorData.account;

  const dealerData = await request("POST", "/api/crm/accounts", adminToken, {
    name: `Phase 8 Dealer ${suffix}`,
    accountType: "dealer",
    accountTypeId: dealerType._id,
    parentAccountId: distributor._id,
    parentRelationshipType: "distributor",
    status: "partner",
    phone: "9666666666",
    city: "Noida",
    assignedTo: salesUserId,
  });
  const dealer = dealerData.account;

  const distributorDealers = await request("GET", `/api/crm/accounts/${distributor._id}/dealers`, adminToken);
  if (!(distributorDealers.dealers || []).some((row) => String(row._id) === String(dealer._id))) {
    throw new Error("Distributor dealers endpoint did not return linked dealer");
  }
  pass("Distributor to dealer hierarchy works");

  const accountData = await request("POST", "/api/crm/accounts", adminToken, {
    name: `Phase 8 Customer ${suffix}`,
    accountType: "customer",
    accountTypeId: customerType._id,
    parentAccountId: dealer._id,
    parentRelationshipType: "dealer",
    status: "customer",
    phone: "9999999999",
    email: `customer-${suffix}@example.com`,
    city: "Noida",
    latitude: 28.6139,
    longitude: 77.209,
    assignedTo: salesUserId,
  });
  const account = accountData.account;
  pass("Create customer account", account.name);

  const productData = await request("POST", "/api/crm/products", adminToken, {
    materialDescription: `Smoke Product ${suffix}`,
    baseUnitOfMeasure: "Piece",
    salesUnit: "Piece",
    standardPrice: 1000,
    maxDiscountPercent: 5,
    stockQuantity: 50,
    currency: "INR",
  });
  const product = productData.product;
  pass("Create product", `${product.materialNumber} ${product.materialDescription}`);

  await request("PUT", `/api/crm/products/${product._id}`, adminToken, {
    standardPrice: 1100,
    priceChangeReason: "Smoke validation price update",
  });
  const priceHistory = await ProductPriceHistory.findOne({ companyId, productId: product._id }).lean();
  if (!priceHistory || priceHistory.oldPrice !== 1000 || priceHistory.newPrice !== 1100) {
    throw new Error("Product price history was not created on price update");
  }
  await request("PUT", `/api/crm/products/${product._id}`, adminToken, {
    standardPrice: 1000,
    priceChangeReason: "Reset smoke validation price",
  });
  pass("Product price history created");

  const lookup = await request("GET", `/api/crm/products/lookup?q=${encodeURIComponent("Smoke Product")}`, salesToken);
  if (!(lookup.products || []).some((item) => String(item._id || item.id) === String(product._id))) {
    throw new Error("Product lookup did not return created product");
  }
  pass("Sales product lookup");

  const started = await request("POST", "/api/crm/visits/start", salesToken, {
    visitTypeId: visitTypeDoc._id,
    entityType: "Account",
    entityId: account._id,
    checkInLatitude: 28.6139,
    checkInLongitude: 77.209,
    checkInAccuracy: 12,
  });
  const visit = started.visit;
  if (!/^VIS-\d{8}-\d{4}$/.test(visit.visitNumber || "")) {
    throw new Error(`Visit number format invalid: ${visit.visitNumber}`);
  }
  pass("Start visit", String(visit._id));

  await expectRequestFailure("PATCH", `/api/crm/visits/${visit._id}/end`, salesToken, {
    notes: "Missing required outcome",
    checkOutLatitude: 28.614,
    checkOutLongitude: 77.2091,
    checkOutAccuracy: 15,
  }, 400, "Outcome is required");
  pass("Visit required outcome validation works");

  const leadData = await request("POST", "/api/crm/leads", salesToken, {
    sourceVisitId: visit._id,
    leadTypeId: leadType.leadType?._id,
    linkedDealerId: dealer._id,
    linkedDistributorId: distributor._id,
    firstName: "Visit",
    lastName: "Lead",
    companyName: `Phase 9 Lead ${suffix}`,
    phone: "8888888888",
    email: `lead-${suffix}@example.com`,
    source: "Visit",
    notes: "Created during active visit",
  });
  const lead = leadData.lead;
  pass("Create lead during visit", String(lead._id));

  const autoFollowUp = await FollowUp.findOne({
    companyId,
    leadId: lead._id,
    source: "lead_create",
    status: "pending",
  }).lean();
  if (!autoFollowUp) throw new Error("Auto follow-up was not created after lead creation");
  pass("Auto follow-up created after lead creation", String(autoFollowUp._id));

  const timelineCreated = await ActivityLog.findOne({
    companyId,
    entityType: "lead",
    entityId: lead._id,
    activityType: "lead_created",
  }).lean();
  if (!timelineCreated) throw new Error("Lead created activity was not logged");
  pass("Lead activity timeline created");

  const dealerLeads = await request("GET", `/api/crm/accounts/${dealer._id}/leads`, adminToken);
  if (!(dealerLeads.leads || []).some((row) => String(row._id) === String(lead._id))) {
    throw new Error("Dealer leads endpoint did not include linked lead");
  }
  pass("Dealer linked lead appears under account");

  const active = await request("GET", "/api/crm/visits/active", salesToken);
  if (!active.visit || String(active.visit._id) !== String(visit._id)) {
    throw new Error("Active visit endpoint did not return started visit");
  }
  pass("Active visit visible");

  const myFollowUps = await request("GET", "/api/crm/followups/my?status=pending", salesToken);
  if (!(myFollowUps.items || []).some((row) => String(row._id) === String(autoFollowUp._id))) {
    throw new Error("My follow-ups endpoint did not include auto follow-up");
  }
  pass("My follow-ups endpoint returns pending follow-up");

  const completeResult = await request("PATCH", `/api/crm/followups/${autoFollowUp._id}/complete`, salesToken, {
    completionNotes: "Customer asked for pricing details.",
    nextFollowUp: {
      followUpType: "whatsapp",
      scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(),
      title: "Share pricing on WhatsApp",
      notes: "Send updated pricing and brochure",
    },
  });
  if (completeResult.followUp?.status !== "completed" || !completeResult.nextFollowUp?._id) {
    throw new Error("Follow-up completion did not create chained follow-up");
  }
  const completedActivity = await ActivityLog.findOne({
    companyId,
    entityType: "lead",
    entityId: lead._id,
    activityType: "followup_completed",
  }).lean();
  if (!completedActivity) throw new Error("Follow-up completion activity was not logged");
  pass("Follow-up completion and chained follow-up works");

  const myLeadsBeforeConvert = await request("GET", "/api/crm/leads?scope=own", salesToken);
  if (!(myLeadsBeforeConvert.leads || []).some((row) => String(row._id) === String(lead._id))) {
    throw new Error("New lead did not appear in own active leads before conversion");
  }

  const convertedLeadData = await request("PATCH", `/api/crm/leads/${lead._id}/convert`, salesToken, {});
  const convertedCustomer = convertedLeadData.customer;
  if (!convertedCustomer?._id) throw new Error("Lead conversion did not return converted customer");
  if (convertedLeadData.lead?.status !== "converted" || !convertedLeadData.lead?.convertedAt) {
    throw new Error("Lead conversion did not mark lead as converted");
  }
  const myLeadsAfterConvert = await request("GET", "/api/crm/leads?scope=own", salesToken);
  if ((myLeadsAfterConvert.leads || []).some((row) => String(row._id) === String(lead._id))) {
    throw new Error("Converted lead still appeared in active own leads");
  }
  pass("Lead converts to customer and leaves active leads", String(convertedCustomer._id));

  await expectRequestFailure("POST", "/api/crm/leads", salesToken, {
    leadTypeId: leadType.leadType?._id,
    firstName: "Missing",
    lastName: "Dealer",
    companyName: `Invalid Lead ${suffix}`,
    linkedDistributorId: distributor._id,
    phone: "8777777777",
    sourceMasterId: leadSources.masters[0]._id,
  }, 400, "This lead type requires a dealer to be linked");
  pass("Lead type dealer requirement enforced");

  await Visit.updateOne(
    { _id: visit._id },
    { $set: { startedAt: new Date(Date.now() - 20 * 60 * 1000), checkInAt: new Date(Date.now() - 20 * 60 * 1000) } }
  );
  const ended = await request("PATCH", `/api/crm/visits/${visit._id}/end`, salesToken, {
    visitOutcomeId: outcome._id,
    notes: "Customer confirmed order at product master base price.",
    productsDiscussed: [product._id],
    nextFollowUpAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    checkOutLatitude: 28.614,
    checkOutLongitude: 77.2091,
    checkOutAccuracy: 15,
    order: {
      accountId: account._id,
      deliveryDate: new Date(Date.now() + 86400000).toISOString(),
      notes: "Smoke order created from visit",
      lineItems: [
        {
          productId: product._id,
          quantity: 2,
        },
      ],
    },
  });
  pass("End visit and create order", ended.visit?.orderCreatedId || "order linked");
  if (ended.visit?.status !== "completed" || !ended.visit?.durationSeconds) {
    throw new Error("Visit was not completed with durationSeconds");
  }
  if (ended.visit?.durationStatus !== "exceeded") {
    throw new Error(`Expected exceeded duration status, got ${ended.visit?.durationStatus}`);
  }
  pass("Visit completion duration validated", ended.visit.durationStatus);
  if (String(ended.summary?.leadCreatedId || "") !== String(lead._id)) {
    throw new Error("Visit end summary did not include created lead id");
  }
  if (!ended.summary?.followUpId) {
    throw new Error("Visit end summary did not include created follow-up id");
  }
  pass("Visit summary includes lead and follow-up");

  const orderId = ended.visit?.orderCreatedId;
  if (!orderId) throw new Error("Visit completion did not create an order");

  const orderDetail = await request("GET", `/api/crm/orders/${orderId}`, salesToken);
  const firstItem = orderDetail.orderItems?.[0];
  if (!firstItem) throw new Error("Order detail has no line items");
  if (firstItem.approvalStatus !== "not_required") {
    throw new Error(`Expected no order approval requirement, got ${firstItem.approvalStatus}`);
  }
  if (Number(firstItem.negotiatedUnitPrice) !== Number(firstItem.basePriceSnapshot)) {
    throw new Error("Order item did not use product base price");
  }
  pass("Order detail uses fixed base price", `approval=${firstItem.approvalStatus}`);

  const followUp = await FollowUp.findOne({
    companyId,
    visitId: visit._id,
    accountId: account._id,
    source: "visit_end",
  }).lean();
  if (!followUp) throw new Error("FollowUp was not created from visit end");
  pass("Follow-up created from visit end", String(followUp._id));

  const myOrders = await request("GET", "/api/crm/orders/my", salesToken);
  if (!(myOrders.orders || []).some((order) => String(order._id) === String(orderId))) {
    throw new Error("My orders endpoint did not include created order");
  }
  pass("My orders list includes order");

  const myVisits = await request("GET", "/api/crm/visits/my", salesToken);
  if (!(myVisits.visits || []).some((row) => String(row._id) === String(visit._id))) {
    throw new Error("My visits endpoint did not include completed visit");
  }
  pass("My visits list includes visit");

  const teamVisits = await request("GET", "/api/crm/visits/team", managerToken);
  if (!(teamVisits.visits || []).some((row) => String(row._id) === String(visit._id))) {
    throw new Error("Sales manager team visits did not include reporting executive visit");
  }
  pass("Sales manager sees team visit only");

  const companyVisits = await request("GET", "/api/crm/visits/company", headToken);
  if (!(companyVisits.visits || []).some((row) => String(row._id) === String(visit._id))) {
    throw new Error("Sales head company visits did not include company visit");
  }
  pass("Sales head sees company visits");

  await expectRequestFailure("GET", "/api/crm/visits/company", salesToken, undefined, 403);
  pass("Wrong role blocked from company visits");

  const executiveDashboard = await request("GET", "/api/crm/reports/executive-dashboard", salesToken);
  if (executiveDashboard.orders.total < 1 || executiveDashboard.visits.total < 1) {
    throw new Error("Executive dashboard did not count visit/order");
  }
  pass("Executive dashboard counts flow", `visits=${executiveDashboard.visits.total}, orders=${executiveDashboard.orders.total}`);

  const managerDashboard = await request("GET", "/api/crm/reports/manager-dashboard", managerToken);
  if (!(managerDashboard.executives || []).some((row) => String(row.executiveId) === String(salesUserId))) {
    throw new Error("Manager dashboard did not include reporting executive");
  }
  pass("Manager dashboard scoped to reporting executives");

  const headDashboard = await request("GET", "/api/crm/reports/head-dashboard", headToken);
  if (!Array.isArray(headDashboard.managers)) {
    throw new Error("Head dashboard did not return manager data");
  }
  pass("Head dashboard returns company-wide data");

  const productReport = await request("GET", "/api/crm/reports/product-performance", adminToken);
  if (!(productReport.rows || []).some((row) => String(row.productId) === String(product._id))) {
    throw new Error("Product performance report did not include ordered product");
  }
  pass("Product performance report includes product");

  await expectRequestFailure("GET", "/api/crm/orders/pending-approvals", adminToken, undefined, 404);
  await expectRequestFailure("PATCH", `/api/crm/orders/${orderId}/approve`, adminToken, { decision: "approved" }, 404);
  pass("Order discount approval endpoints removed");
};

main()
  .then(async () => {
    await cleanup();
    pass("Cleanup test data");
    console.log("\nSUMMARY");
    results.forEach((item) => console.log(`${item.status} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`));
    process.exit(0);
  })
  .catch(async (error) => {
    fail("Smoke test failed", error);
    await cleanup().catch((cleanupError) => fail("Cleanup failed", cleanupError));
    console.log("\nSUMMARY");
    results.forEach((item) => console.log(`${item.status} ${item.label}${item.detail ? ` - ${item.detail}` : ""}`));
    process.exit(1);
  })
  .finally(async () => {
    if (server) server.close();
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
