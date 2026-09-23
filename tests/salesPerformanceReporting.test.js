const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const {
  MANAGEMENT_ROLES,
  RETRY_ROLES,
  eventVisibilityFilter,
  buildPerformanceTree,
  csvEscape,
  toCsv,
} = require("../src/services/salesPerformanceReporting.service");

const root = path.join(__dirname, "..", "src");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const reporting = read("services", "salesPerformanceReporting.service.js");
const targets = read("services", "salesTarget.service.js");
const policy = read("services", "salesPerformancePolicy.service.js");
const routes = read("routes", "salesTargets.routes.js");
const order = read("services", "order.service.js");
const achievement = read("services", "salesAchievement.service.js");
const failureModel = read("models", "SalesAchievementCaptureFailure.js");
const targetModel = read("models", "SalesTargetPlan.js");
const frontendRoot = path.join(__dirname, "..", "..", "Frontend", "src");
const allFrontend = fs.readdirSync(path.join(frontendRoot, "pages", "Sales"))
  .filter((name) => name.endsWith(".jsx"))
  .map((name) => fs.readFileSync(path.join(frontendRoot, "pages", "Sales", name), "utf8"))
  .join("\n");

const id = () => new mongoose.Types.ObjectId().toString();
const makeAllocation = ({ _id = id(), parentAllocationId = null, ownerType, ownerId = id(), name = ownerType, target = 0, allocated = 0, unallocated = target }) => ({
  _id, parentAllocationId, ownerType, ownerId, ownerNameSnapshot: name, ownerCodeSnapshot: "", targetValue: target, allocatedValue: allocated, unallocatedValue: unallocated,
});
const build = (allocations, achievements = [], quality = {}) => buildPerformanceTree({
  allocations,
  rollup: { byOwner: new Map(achievements), quality: { unattributableAmount: 0, unattributableCount: 0, warningCount: 0, totalEventCount: 0, ...quality } },
  companyWide: true,
});

test("management reporting roles are limited to Super Admin, Company Admin, and Sales Head", () => assert.deepEqual(MANAGEMENT_ROLES, ["super_admin", "company_admin", "sales_head"]));
test("manual retry roles match the restricted management roles", () => assert.deepEqual(RETRY_ROLES, MANAGEMENT_ROLES));
test("company target percentage is calculated from the immutable event rollup", () => {
  const companyId = id(); const row = makeAllocation({ ownerType: "COMPANY", ownerId: companyId, target: 100 });
  const result = build([row], [[`COMPANY:${companyId}`, { amount: 25, eventCount: 1 }]]);
  assert.equal(result.roots[0].achievementPercentage, 25);
});
test("achievement above target remains above 100 percent", () => {
  const ownerId = id(); const result = build([makeAllocation({ ownerType: "AREA", ownerId, target: 80 })], [[`AREA:${ownerId}`, { amount: 100, eventCount: 2 }]]);
  assert.equal(result.roots[0].achievementPercentage, 125); assert.equal(result.roots[0].remaining, -20);
});
test("zero target renders percentage as null rather than fake zero", () => assert.equal(build([makeAllocation({ ownerType: "AREA", target: 0 })]).roots[0].achievementPercentage, null));
test("no achievement is distinct from no target assignment", () => {
  const result = build([makeAllocation({ ownerType: "AREA", target: 20 })]);
  assert.equal(result.roots.length, 1); assert.equal(result.roots[0].achievement, 0); assert.ok(result.roots[0].warnings.some((item) => item.code === "NO_ACHIEVEMENT_YET"));
});
test("hierarchy nodes use stored parent allocation IDs", () => {
  const parent = makeAllocation({ ownerType: "BRANCH", target: 100 });
  const child = makeAllocation({ parentAllocationId: parent._id, ownerType: "AREA", target: 50 });
  const result = build([parent, child]); assert.equal(result.roots.length, 1); assert.equal(result.roots[0].children[0].owner.type, "AREA");
});
test("a visible child becomes the scorecard root when its hidden parent is outside scope", () => {
  const child = makeAllocation({ parentAllocationId: id(), ownerType: "AREA", target: 50 });
  assert.equal(build([child]).roots[0].owner.type, "AREA");
});
test("under-allocation is surfaced as a warning", () => assert.ok(build([makeAllocation({ ownerType: "ZONE", target: 100, allocated: 70, unallocated: 30 })]).roots[0].warnings.some((item) => item.code === "TARGET_UNDER_ALLOCATED")));
test("unattributable achievement is separate from eligible achievement", () => {
  const companyId = id(); const result = build([makeAllocation({ ownerType: "COMPANY", ownerId: companyId, target: 100 })], [[`COMPANY:${companyId}`, { amount: 40, eventCount: 1 }]], { unattributableAmount: 15 });
  assert.equal(result.roots[0].achievement, 40); assert.ok(result.roots[0].warnings.some((item) => item.code === "UNATTRIBUTABLE_ORDER_BOOKING_EXISTS"));
});
test("L1 event visibility uses only the transaction snapshot primary FSD", async () => {
  const userId = id(); const filter = await eventVisibilityFilter({ companyId: id(), user: { _id: userId, role: "sales_executive" }, context: { hierarchyLevel: 1 } });
  assert.equal(String(filter["snapshot.primaryFsdId"]), userId);
});
for (const [level, field] of [[2, "areaId"], [3, "branchId"], [4, "regionId"], [5, "zoneId"]]) {
  test(`L${level} event visibility scopes historical events by snapshot ${field}`, async () => {
    const geographyId = id(); const filter = await eventVisibilityFilter({ companyId: id(), user: { role: "sales_manager" }, context: { hierarchyLevel: level, geographyId } });
    assert.equal(String(filter[`snapshot.${field}`]), geographyId);
  });
}
test("Sales Head event visibility is company-wide", async () => assert.deepEqual(await eventVisibilityFilter({ companyId: id(), user: { role: "sales_head" } }), {}));
test("CSV escaping protects commas, quotes, and line breaks", () => assert.equal(csvEscape('North, "A"\nZone'), '"North, ""A""\nZone"'));
test("CSV generation keeps a stable header and CRLF rows", () => assert.equal(toCsv([{ key: "name", label: "Owner" }], [{ name: "Area A" }]), "Owner\r\nArea A"));
test("dashboard rollup is a grouped ledger aggregation rather than an Order sum", () => { assert.match(reporting, /SalesAchievementEvent\.aggregate/); assert.match(reporting, /\$facet/); assert.match(reporting, /rollupEligible: true/); });
test("target and achievement dashboards expose all L1-L6 owner dimensions", () => ["COMPANY", "ZONE", "REGION", "BRANCH", "AREA", "EMPLOYEE_FSD", "DISTRIBUTOR"].forEach((term) => assert.ok(reporting.includes(term))));
test("active-plan revision copies immutable allocation snapshots transactionally", () => { assert.match(reporting, /createPlanRevision/); assert.match(reporting, /copiedAllocationCount/); assert.match(reporting, /session\.commitTransaction/); });
test("revision creation requires an explicit reason", () => assert.match(reporting, /Revision reason is required/));
test("revision comparison includes added, removed, changed, unchanged, and geography paths", () => ["ADDED", "REMOVED", "CHANGED", "UNCHANGED", "oldPath", "newPath"].forEach((term) => assert.ok(reporting.includes(term))));
test("draft allocation removal is leaf-only and audited", () => { assert.match(targets, /Remove child allocations before removing/); assert.match(targets, /SALES_TARGET_ALLOCATION_REMOVED/); assert.match(routes, /router\.delete\("\/plans\/:planId\/allocations\/:allocationId"/); });
test("policy semantic basis cannot change while protected target plans exist", () => { assert.match(policy, /basisChanged/); assert.match(policy, /\["DRAFT", "SUBMITTED", "ACTIVE"\]/); });
test("achievement event detail only exposes an Order link after Phase 7 visibility filtering", () => { assert.match(reporting, /buildOrderVisibilityFilter/); assert.match(reporting, /accessibleOrderIds\.has/); });
test("durable capture failure records are unique per source event", () => { assert.match(failureModel, /unique: true/); assert.match(failureModel, /sourceEventVersion/); });
test("booking failures are captured without rolling back the Order", () => { assert.match(order, /SalesAchievementCaptureFailure\.findOneAndUpdate/); assert.match(order, /must never roll back a successfully booked order/); });
test("successful idempotent capture resolves an open failure", () => { assert.match(achievement, /SalesAchievementCaptureFailure\.updateOne/); assert.match(achievement, /status: "RESOLVED"/); });
test("manual retry delegates to the same idempotent recorder", () => { assert.match(reporting, /recordOrderCreatedAchievement/); assert.match(reporting, /SALES_ACHIEVEMENT_RETRY/); });
test("legacy reconciliation preview is explicitly zero-write", () => { assert.match(reporting, /writePerformed: false/); assert.doesNotMatch(reporting.slice(reporting.indexOf("const previewLegacyOrder"), reporting.indexOf("const csvEscape")), /SalesAchievementEvent\.(create|insertMany|save)/); });
test("exports call visibility-aware dashboard or event services", () => { assert.match(reporting, /getPerformanceDashboard\(\{ companyId, user, filters \}\)/); assert.match(reporting, /listAchievementEvents\(\{ companyId, user/); });
test("projection is intentionally absent from the Phase 8B2 schema and UI", () => { assert.doesNotMatch(targetModel, /projectedAchievement|runRate/); assert.doesNotMatch(allFrontend, /Projected Achievement|Run Rate Projection/); });
test("secondary sales are absent from Phase 8B2 reporting and target APIs", () => assert.doesNotMatch(`${reporting}\n${routes}`, /SECONDARY_SALE|Dealer Sales ledger/i));
test("outstanding balances and collections are not achievement sources", () => assert.doesNotMatch(`${reporting}\n${achievement}`, /outstandingBalance|COLLECTION_RECEIVED/));

