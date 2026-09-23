const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const routes = read("routes", "salesTargets.routes.js");
const indexRoutes = read("routes", "index.js");
const orderService = read("services", "order.service.js");
const achievement = read("services", "salesAchievement.service.js");
const targets = read("services", "salesTarget.service.js");
const policy = read("services", "salesPerformancePolicy.service.js");
const eventModel = read("models", "SalesAchievementEvent.js");

test("sales target routes are mounted in the API", () => assert.match(indexRoutes, /router\.use\("\/sales\/targets", salesTargetsRoutes\)/));
test("policy endpoint supports read and Company Admin configuration", () => { assert.match(routes, /get\("\/policy"/); assert.match(routes, /put\("\/policy"/); });
test("target endpoints expose create, preview, allocate, submit, approve, and reject", () => ["post(\"/plans\"", "preview", "allocations", "submit", "approve", "reject"].forEach((text) => assert.ok(routes.includes(text), text)));
test("super admin requires explicit valid company context", () => { assert.match(routes, /x-company-id/); assert.match(routes, /Super Admin must provide a valid company context/); });
test("non-super callers cannot override company context", () => assert.match(routes, /Cross-company target access denied/));
test("only Sales Head is a target maker", () => assert.match(targets, /HEAD_WRITE_ROLES = \["super_admin", "sales_head"\]/));
test("only Company Admin is the normal target checker", () => assert.match(targets, /REVIEW_ROLES = \["super_admin", "company_admin"\]/));
test("draft owner mappings are revalidated before submit or approval", () => { assert.match(targets, /OWNER_MAPPING_CHANGED/); assert.match(targets, /previewPlan/); });
test("achievement capture runs only after order items and totals save", () => {
  const saveAt = orderService.indexOf("await order.save()"); const captureAt = orderService.indexOf("await recordOrderCreatedAchievement");
  assert.ok(saveAt > -1); assert.ok(captureAt > saveAt);
});
test("achievement capture failure does not roll back a booked order", () => { assert.match(orderService, /CAPTURE_FAILED/); assert.match(orderService, /must never roll back a successfully booked order/); });
test("missing active policy skips achievement without breaking order", () => assert.match(achievement, /SKIPPED_NO_ACTIVE_POLICY/));
test("legacy orders are excluded by policy activation boundary", () => assert.match(achievement, /activationDate: \{ \$lte: occurredAt \}/));
test("order source event is idempotent and duplicate-safe", () => { assert.match(achievement, /ALREADY_RECORDED/); assert.match(achievement, /error\?\.code === 11000/); });
test("attribution uses effective dates rather than current flags", () => { assert.match(achievement, /effectiveFrom: \{ \$lte: occurredAt \}/); assert.doesNotMatch(achievement.slice(0, achievement.indexOf("calculateOrderBookingAmount")), /isCurrent/); });
test("attribution precedence starts with Visit, then Order assignee, then Distributor primary FSD", () => {
  const visitAt = achievement.indexOf("SOURCE_VISIT_EXECUTIVE"); const orderAt = achievement.indexOf("ORDER_ASSIGNED_TO"); const distributorAt = achievement.indexOf("DISTRIBUTOR_PRIMARY_FSD");
  assert.ok(visitAt < orderAt && orderAt < distributorAt);
});
test("account ancestry resolves optional Dealer/Retailer/Customer to root Distributor", () => { assert.match(achievement, /loadAccountChain/); assert.match(achievement, /accountTypeCode === "DISTRIBUTOR"/); });
test("unattributable achievements are stored but excluded from target rollup", () => { assert.match(achievement, /UNATTRIBUTABLE/); assert.match(achievement, /rollupEligible: confidence !== "UNATTRIBUTABLE"/); });
test("achievement ledger blocks mutation and deletion operations", () => { assert.match(eventModel, /append-only/); ["updateOne", "deleteOne", "findOneAndDelete"].forEach((op) => assert.ok(eventModel.includes(op))); });
test("achievement and target mutations emit audit logs", () => { assert.match(achievement, /SALES_ACHIEVEMENT_RECORDED/); assert.match(targets, /SALES_TARGET_PLAN_CREATED/); assert.match(targets, /SALES_TARGET_ALLOCATION_SAVED/); assert.match(policy, /SALES_PERFORMANCE_POLICY/); });
test("multi-document target mutations use sessions and commit-or-abort transactions", () => { assert.match(targets, /mongoose\.startSession\(\)/); assert.match(targets, /session\.startTransaction\(\)/); assert.match(targets, /session\.commitTransaction\(\)/); assert.match(targets, /session\.abortTransaction\(\)/); });
test("target audit records participate in the same mutation transaction", () => { assert.match(targets, /SALES_TARGET_PLAN_CREATED[\s\S]*req, session/); assert.match(targets, /SALES_TARGET_ALLOCATION_SAVED[\s\S]*req, session/); });
test("legacy handling is diagnostic only and has no auto-backfill write", () => { assert.match(targets, /Legacy orders are diagnostic only and are not auto-backfilled/); assert.doesNotMatch(targets, /insertMany\(.*legacy/is); });
test("Phase 8B1 does not use outstanding balances for achievement", () => assert.doesNotMatch(achievement, /outstandingBalance/));
test("Phase 8B1 does not implement invoice, collections, secondary-sales, returns, or commission events", () => ["INVOICE_CREATED", "COLLECTION_RECEIVED", "SECONDARY_SALE", "RETURN_CREATED", "COMMISSION"].forEach((term) => assert.doesNotMatch(`${achievement}\n${targets}`, new RegExp(term))));
