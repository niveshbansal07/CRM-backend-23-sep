const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relative) => fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

test("Phase 5A has a dedicated request model and active-request uniqueness", () => {
  const model = read("src/models/DistributorReassignmentRequest.js");
  const constants = read("src/constants/distributorReassignment.js");
  assert.match(model, /SAME_AREA_FSD_REASSIGNMENT/);
  assert.match(constants, /PENDING/);
  assert.match(constants, /APPROVED/);
  assert.match(constants, /REJECTED/);
  assert.match(constants, /CANCELLED/);
  assert.match(constants, /APPLIED/);
  assert.match(model, /uniq_open_distributor_reassignment/);
  assert.match(model, /operationId/);
});

test("effective-dated assignment links replacement to previous ownership", () => {
  const mapping = read("src/models/DistributorSalesAssignment.js");
  assert.match(mapping, /previousAssignmentId/);
  assert.match(mapping, /uniq_current_distributor_sales_mapping/);
});

test("reassignment API exposes lifecycle and history without modifying Phase 4A initial routes", () => {
  const routes = read("src/routes/distributorReassignment.routes.js");
  const initialRoutes = read("src/routes/distributorSalesMapping.routes.js");
  assert.match(routes, /\/readiness/);
  assert.match(routes, /\/preview/);
  assert.match(routes, /\/requests/);
  assert.match(routes, /\/approve/);
  assert.match(routes, /\/reject/);
  assert.match(routes, /\/cancel/);
  assert.match(routes, /\/history/);
  assert.match(initialRoutes, /\/apply/);
  assert.doesNotMatch(initialRoutes, /reassign|approve|reject|cancel/i);
});

test("safe payload validator rejects client-authored geography and ownership snapshots", () => {
  const validator = read("src/validators/distributorReassignment.validator.js");
  assert.match(validator, /distributorAccountId/);
  assert.match(validator, /newPrimaryFsdId/);
  assert.match(validator, /reason/);
  assert.doesNotMatch(validator, /"companyId"|"oldPrimaryFsdId"|"geographyId"|"operationId"/);
});

test("Phase 5A service does not mutate employee geography, dealer/customer hierarchy, targets, or historical CRM", () => {
  const service = read("src/services/distributorReassignment.service.js");
  assert.doesNotMatch(service, /SalesEmployeeGeographyAssignment\.(create|update|findOneAndUpdate|delete)/);
  assert.doesNotMatch(service, /parentAccountId|linkedDistributorId|Lead\.(create|update)|Order\.(create|update)|Visit\.(create|update)|Activity\.(create|update)|SalesTarget/);
  assert.match(service, /geographyId: request\.geographyId/);
  assert.match(service, /account\.assignedTo = request\.newPrimaryFsdId/);
});
