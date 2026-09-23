const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("Phase 6A reuses Account parent hierarchy and adds only Retailer relationship compatibility", () => {
  const account = read("src/models/Account.js");
  assert.match(account, /parentAccountId/); assert.match(account, /parentRelationshipType/); assert.match(account, /"retailer"/);
  for (const replacement of ["Dealer.js", "Retailer.js", "Customer.js"]) assert.equal(fs.existsSync(path.join(__dirname, "..", "src/models", replacement)), false);
});

test("safe Channel Mapping payload excludes company, ownership, Geography, and authority snapshots", () => {
  const validator = read("src/validators/channelMapping.validator.js");
  assert.match(validator, /childAccountId/); assert.match(validator, /distributorAccountId/); assert.match(validator, /customerAccountId/); assert.match(validator, /parentAccountId/); assert.match(validator, /reason/);
  assert.doesNotMatch(validator, /"companyId"|"primaryFsdId"|"areaId"|"zoneId"|"approverId"|"operationId"/);
});

test("Channel Mapping API exposes readiness, preview, apply, hierarchy, and Distributor children", () => {
  const routes = read("src/routes/channelMapping.routes.js");
  for (const route of ["/readiness", "/preview", "/apply", "/dealers/", "/retailers/", "/customers/", "/distributors/"]) assert.match(routes, new RegExp(route));
});

test("Phase 6A never mutates Distributor assignments, employee Geography, targets, visibility, Leads, or historical CRM", () => {
  const service = read("src/services/channelMapping.service.js");
  assert.doesNotMatch(service, /DistributorMapping\.(create|update|delete)|EmployeeAssignment\.(create|update|delete)|SalesTarget|Lead\.(create|update)|Order\.(create|update)|Visit\.(create|update)/);
  assert.doesNotMatch(service, /assignedTo\s*=/);
  assert.match(service, /parentAccountId = preview\.proposedParent\.id/);
});

test("Dealer Lead optional Distributor selection and conversion contract remains unchanged", () => {
  const leadService = read("src/services/lead.service.js");
  const page = read("../Frontend/src/pages/Sales/CreateLeadPage.jsx");
  assert.match(page, /Link this Dealer to a Distributor/);
  assert.match(page, /Optional\. The Dealer will be placed under the selected Distributor after conversion/);
  assert.match(leadService, /dealerLead && lead\.linkedDistributorId/);
  assert.match(leadService, /customer\.parentAccountId = distributor\?\._id \|\| null/);
});

test("generic Account updates invoke narrow governed-parent bypass protection", () => {
  const accountService = read("src/services/account.service.js");
  assert.match(accountService, /assertChannelParentMutationAllowed/);
  assert.match(accountService, /validateInitialParent/);
});
