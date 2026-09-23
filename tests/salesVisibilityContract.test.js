const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("one shared visibility service owns Geography, employee, channel, and entity predicates", () => {
  const source = read("src/services/salesVisibility.service.js");
  for (const token of [
    "resolveSalesVisibilityContext", "deriveDescendants", "resolveAccessibleAccountScope",
    "buildLeadVisibilityFilter", "buildOrderVisibilityFilter", "buildVisitVisibilityFilter",
    "buildFollowUpVisibilityFilter",
  ]) assert.match(source, new RegExp(token));
});

test("Lead list, detail, nested reads and mutations receive authenticated actor scope", () => {
  const routes = read("src/routes/leads.routes.js");
  const service = read("src/services/lead.service.js");
  assert.match(routes, /getLeadById\(companyId, req\.params\.id, req\.user\)/);
  assert.match(routes, /getLeadById\(requireCompanyContext\(req\), req\.params\.leadId, req\.user\)/);
  assert.match(service, /buildLeadVisibilityFilter/);
  assert.match(service, /assertEmployeeWithinVisibility/);
});

test("Account root, detail, hierarchy and subresources are actor scoped", () => {
  const routes = read("src/routes/accounts.routes.js");
  const service = read("src/services/account.service.js");
  assert.match(routes, /getAccountHierarchyTree\(companyId, req\.user\)/);
  assert.match(routes, /getAccountById\(req\.params\.id, companyId, req\.user\)/);
  assert.match(service, /resolveAccessibleAccountScope/);
  assert.match(service, /buildVisitVisibilityFilter/);
  assert.match(service, /buildOrderVisibilityFilter/);
});

test("Order root, team and detail routes all pass backend actor authority", () => {
  const routes = read("src/routes/orders.routes.js");
  assert.equal((routes.match(/listOrders\(companyId,[^;]+req\.user\)/g) || []).length, 3);
  assert.match(routes, /getOrderById\(companyId, req\.params\.id, req\.user\)/);
});

test("Visit detail and route both pass authenticated actor and team no longer uses reportingManagerId", () => {
  const routes = read("src/routes/visits.routes.js");
  assert.match(routes, /getVisitRoute\(req\.params\.id, companyId, req\.user\)/);
  assert.match(routes, /getVisitDetail\(req\.params\.id, companyId, req\.user\)/);
  assert.doesNotMatch(routes, /listVisits\(companyId, \{ reportingManagerId:/);
});

test("dedicated and nested Follow-up APIs use the same visibility engine", () => {
  const routes = read("src/routes/leads.routes.js");
  const service = read("src/services/followUp.service.js");
  assert.match(routes, /getFollowUpsForLead\([^;]+req\.user\)/s);
  assert.match(service, /buildFollowUpVisibilityFilter/);
  assert.match(service, /resolveSalesVisibilityContext/);
});

test("report scope delegates to hierarchy and Geography rather than direct reporting", () => {
  const source = read("src/services/salesReport.service.js");
  const scopeBody = source.slice(source.indexOf("const scopeExecutiveIds"), source.indexOf("const getVisitsReport"));
  assert.match(scopeBody, /resolveSalesVisibilityContext/);
  assert.doesNotMatch(scopeBody, /getDirectExecutives/);
});

test("Channel hierarchy reads are scoped while Phase 6A mutation authority is unchanged", () => {
  const routes = read("src/routes/channelMapping.routes.js");
  const service = read("src/services/channelMapping.service.js");
  assert.match(routes, /post\("\/apply", allowRoles\(\.\.\.CHANNEL_MAPPING_MANAGE_ROLES\)/);
  assert.match(routes, /get\("\/dealers\/:accountId\/hierarchy", allowRoles\(\.\.\.CHANNEL_MAPPING_READ_ROLES\)/);
  assert.match(service, /assertAccountWithinVisibility/);
});

test("frontend Account selectors rely on backend channel visibility, not assignedTo=me", () => {
  assert.doesNotMatch(read("../Frontend/src/pages/Sales/OrderCreatePage.jsx"), /accountApi\.getAll\(\{ assignedTo: 'me' \}\)/);
  assert.doesNotMatch(read("../Frontend/src/pages/Sales/VisitStartPage.jsx"), /assignedTo: 'me', search: entitySearch/);
});

test("Phase 7 adds no target model, migration, or CRM ownership rewrite", () => {
  const visibility = read("src/services/salesVisibility.service.js");
  assert.doesNotMatch(visibility, /Target|updateMany|bulkWrite|reportingManagerId\s*=/);
});

test("Dealer Lead optional Distributor contract remains unchanged", () => {
  const page = read("../Frontend/src/pages/Sales/CreateLeadPage.jsx");
  const leadService = read("src/services/lead.service.js");
  assert.match(page, /Link this Dealer to a Distributor/);
  assert.match(page, /Optional\. The Dealer will be placed under the selected Distributor after conversion\./);
  assert.match(leadService, /distributor\?\._id \|\| null/);
});
