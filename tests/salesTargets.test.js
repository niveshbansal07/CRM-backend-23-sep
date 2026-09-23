const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { SALES_PERFORMANCE, OWNER_TYPES, OWNER_CHILDREN, PLAN_STATUSES, ATTRIBUTION_CONFIDENCE } = require("../src/constants/salesPerformance");
const { roundMoney, moneyNumber, moneyDecimal, assertMoney, assertTimezone, resolveMonthPeriod, zonedDateTimeToUtc } = require("../src/utils/salesPerformance");
const { validateAllocationTotals, assertTransition, buildPreview, TARGET_READ_ROLES, HEAD_WRITE_ROLES, REVIEW_ROLES } = require("../src/services/salesTarget.service");
const { calculateOrderBookingAmount, effectiveAt } = require("../src/services/salesAchievement.service");
const Policy = require("../src/models/CompanySalesPerformancePolicy");
const Plan = require("../src/models/SalesTargetPlan");
const Allocation = require("../src/models/SalesTargetAllocation");
const Achievement = require("../src/models/SalesAchievementEvent");

const id = () => new mongoose.Types.ObjectId();
const allocation = ({ ownerType = "COMPANY", target = 100, parentAllocationId = null, allocated = 0, unallocated = target } = {}) => ({
  _id: id(), ownerType, ownerId: id(), parentAllocationId,
  targetValue: moneyDecimal(target), allocatedValue: moneyDecimal(allocated), unallocatedValue: moneyDecimal(unallocated),
});

test("MVP metric is Order Booking and not Revenue", () => {
  assert.equal(SALES_PERFORMANCE.METRIC_CODE, "ORDER_VALUE_EX_TAX_AFTER_DISCOUNT");
  assert.equal(SALES_PERFORMANCE.METRIC_LABEL, "Order Booking");
  assert.notEqual(SALES_PERFORMANCE.METRIC_LABEL, "Revenue");
});

test("fixed performance policy values match the approved MVP", () => {
  assert.deepEqual({ trigger: SALES_PERFORMANCE.TRIGGER, basis: SALES_PERFORMANCE.VALUE_BASIS, period: SALES_PERFORMANCE.PERIOD_TYPE }, { trigger: "ORDER_CREATED", basis: "DISCOUNTED_EX_TAX", period: "MONTH" });
  assert.equal(SALES_PERFORMANCE.ALLOCATION_POLICY, "CONTROLLED_FLEXIBLE");
  assert.equal(SALES_PERFORMANCE.ATTRIBUTION_POLICY, "TRANSACTION_TIME");
});

test("defaults persist INR, Asia/Kolkata, and April fiscal start", () => {
  assert.equal(SALES_PERFORMANCE.DEFAULT_CURRENCY, "INR");
  assert.equal(SALES_PERFORMANCE.DEFAULT_TIMEZONE, "Asia/Kolkata");
  assert.equal(SALES_PERFORMANCE.DEFAULT_FISCAL_START_MONTH, 4);
});

test("target owner allow-list is exact", () => {
  assert.deepEqual(OWNER_TYPES, ["COMPANY", "ZONE", "REGION", "BRANCH", "AREA", "EMPLOYEE_FSD", "DISTRIBUTOR"]);
  assert.equal(OWNER_TYPES.includes("DEALER"), false);
  assert.equal(OWNER_TYPES.includes("RETAILER"), false);
  assert.equal(OWNER_TYPES.includes("CUSTOMER"), false);
});

test("owner hierarchy is Company through Distributor", () => {
  assert.deepEqual(OWNER_CHILDREN.COMPANY, ["ZONE"]);
  assert.deepEqual(OWNER_CHILDREN.ZONE, ["REGION"]);
  assert.deepEqual(OWNER_CHILDREN.REGION, ["BRANCH"]);
  assert.deepEqual(OWNER_CHILDREN.BRANCH, ["AREA"]);
  assert.deepEqual(OWNER_CHILDREN.AREA, ["EMPLOYEE_FSD"]);
  assert.deepEqual(OWNER_CHILDREN.EMPLOYEE_FSD, ["DISTRIBUTOR"]);
  assert.deepEqual(OWNER_CHILDREN.DISTRIBUTOR, []);
});

test("money rounds explicitly to two decimal places", () => assert.equal(roundMoney(10.125), 10.13));
test("money decimal round-trips without binary presentation drift", () => assert.equal(moneyNumber(moneyDecimal(100.1)), 100.1));
test("negative target value is rejected", () => assert.throws(() => assertMoney(-0.01), /non-negative/));
test("non-numeric target value is rejected", () => assert.throws(() => assertMoney("abc"), /non-negative/));
test("valid IANA timezone is accepted", () => assert.equal(assertTimezone("Asia/Kolkata"), "Asia/Kolkata"));
test("invalid IANA timezone is rejected", () => assert.throws(() => assertTimezone("Asia/Not-A-Place"), /Invalid IANA timezone/));

test("monthly period uses timezone-aware inclusive/exclusive UTC boundaries", () => {
  const period = resolveMonthPeriod({ year: 2026, month: 8, timezone: "Asia/Kolkata", fiscalStartMonth: 4 });
  assert.equal(period.periodStart.toISOString(), "2026-07-31T18:30:00.000Z");
  assert.equal(period.periodEndExclusive.toISOString(), "2026-08-31T18:30:00.000Z");
  assert.equal(period.periodKey, "2026-08");
});

test("December monthly period rolls into the next calendar year", () => {
  const period = resolveMonthPeriod({ year: 2026, month: 12, timezone: "Asia/Kolkata", fiscalStartMonth: 4 });
  assert.equal(period.periodEndExclusive.toISOString(), "2026-12-31T18:30:00.000Z");
});

test("fiscal label respects April start", () => {
  assert.equal(resolveMonthPeriod({ year: 2026, month: 3, fiscalStartMonth: 4 }).fiscalYearLabel, "FY2025-26");
  assert.equal(resolveMonthPeriod({ year: 2026, month: 4, fiscalStartMonth: 4 }).fiscalYearLabel, "FY2026-27");
});

test("general zoned conversion handles UTC zone", () => assert.equal(zonedDateTimeToUtc({ year: 2026, month: 1, day: 1 }, "UTC").toISOString(), "2026-01-01T00:00:00.000Z"));
test("invalid target month is rejected", () => assert.throws(() => resolveMonthPeriod({ year: 2026, month: 13 }), /Valid target year and month/));

test("under-allocation is valid and remains explicit", () => assert.deepEqual(validateAllocationTotals({ parentTarget: 100, childTargets: [25, 30] }), { target: 100, allocated: 55, unallocated: 45, valid: true, overAllocatedBy: 0 }));
test("full allocation is valid", () => assert.deepEqual(validateAllocationTotals({ parentTarget: 100, childTargets: [50, 50] }), { target: 100, allocated: 100, unallocated: 0, valid: true, overAllocatedBy: 0 }));
test("over-allocation is blocked", () => assert.deepEqual(validateAllocationTotals({ parentTarget: 100, childTargets: [70, 31] }), { target: 100, allocated: 101, unallocated: -1, valid: false, overAllocatedBy: 1 }));
test("allocation sums use money precision", () => assert.equal(validateAllocationTotals({ parentTarget: 0.3, childTargets: [0.1, 0.2] }).allocated, 0.3));

test("DRAFT can transition only to SUBMITTED", () => { assert.equal(assertTransition("DRAFT", "SUBMITTED"), true); assert.throws(() => assertTransition("DRAFT", "ACTIVE"), /Invalid target plan transition/); });
test("SUBMITTED can transition to ACTIVE", () => assert.equal(assertTransition("SUBMITTED", "ACTIVE"), true));
test("SUBMITTED can transition to REJECTED", () => assert.equal(assertTransition("SUBMITTED", "REJECTED"), true));
test("ACTIVE is immutable except supersede", () => { assert.equal(assertTransition("ACTIVE", "SUPERSEDED"), true); assert.throws(() => assertTransition("ACTIVE", "DRAFT"), /Invalid target plan transition/); });
test("REJECTED cannot be mutated", () => assert.throws(() => assertTransition("REJECTED", "DRAFT"), /Invalid target plan transition/));

test("preview allows under-allocation as a warning without writes", () => {
  const root = allocation({ target: 100 });
  const child = allocation({ ownerType: "ZONE", target: 60, parentAllocationId: root._id });
  const preview = buildPreview({ _id: id(), status: "DRAFT" }, [root, child]);
  assert.equal(preview.valid, true); assert.equal(preview.blockers.length, 0); assert.equal(preview.warnings[0].code, "UNDER_ALLOCATED");
});

test("preview reports a missing company root", () => {
  const preview = buildPreview({ _id: id(), status: "DRAFT" }, [allocation({ ownerType: "ZONE" })]);
  assert.equal(preview.valid, false); assert.equal(preview.blockers[0].code, "MISSING_COMPANY_TARGET");
});

test("order booking amount subtracts line discounts and excludes tax", () => {
  const result = calculateOrderBookingAmount([{ lineSubtotal: 100, discountAmount: 10 }, { lineSubtotal: 50, discountAmount: 5 }], { grandTotal: 153, taxTotal: 18 });
  assert.equal(result.amount, 135); assert.equal(result.headerAmount, 135); assert.equal(result.consistent, true);
});

test("amount consistency tolerance flags material header mismatch", () => {
  const result = calculateOrderBookingAmount([{ lineSubtotal: 100, discountAmount: 10 }], { grandTotal: 120, taxTotal: 20 });
  assert.equal(result.amount, 90); assert.equal(result.consistent, false); assert.equal(result.difference, 10);
});

test("effective-date lookup uses half-open assignment intervals", () => {
  const at = new Date("2026-08-01T00:00:00.000Z");
  const filter = effectiveAt(at);
  assert.deepEqual(filter.effectiveFrom, { $lte: at });
  assert.deepEqual(filter.$or, [{ effectiveTo: null }, { effectiveTo: { $gt: at } }]);
  assert.equal("isCurrent" in filter, false);
});

test("maker, checker, and reader roles are separated", () => {
  assert.deepEqual(HEAD_WRITE_ROLES, ["super_admin", "sales_head"]);
  assert.deepEqual(REVIEW_ROLES, ["super_admin", "company_admin"]);
  assert.equal(TARGET_READ_ROLES.includes("sales_manager"), true);
  assert.equal(TARGET_READ_ROLES.includes("sales_executive"), true);
  assert.equal(TARGET_READ_ROLES.includes("sub_admin"), false);
});

test("policy schema fixes the approved metric and trigger", () => {
  assert.deepEqual(Policy.schema.path("metricCode").enumValues, [SALES_PERFORMANCE.METRIC_CODE]);
  assert.deepEqual(Policy.schema.path("trigger").enumValues, ["ORDER_CREATED"]);
  assert.deepEqual(Policy.schema.path("periodType").enumValues, ["MONTH"]);
});

test("plan schema persists lifecycle and period version fields", () => {
  assert.deepEqual(Plan.schema.path("status").enumValues, PLAN_STATUSES);
  ["periodStart", "periodEndExclusive", "policyVersion", "version", "revisionOfPlanId", "approvedBy", "rejectionReason"].forEach((field) => assert.ok(Plan.schema.path(field), field));
});

test("plan has one-active-plan partial unique index", () => {
  const index = Plan.schema.indexes().find(([, options]) => options.name === "uniq_active_target_period");
  assert.ok(index); assert.equal(index[1].unique, true); assert.deepEqual(index[1].partialFilterExpression, { status: "ACTIVE" });
});

test("allocation schema restricts target owner types", () => assert.deepEqual(Allocation.schema.path("ownerType").enumValues, OWNER_TYPES));

test("allocation schema uses Decimal128 monetary fields", () => {
  ["targetValue", "allocatedValue", "unallocatedValue"].forEach((field) => assert.equal(Allocation.schema.path(field).instance, "Decimal128"));
});

test("allocation uniqueness prevents duplicate owner in one plan", () => {
  const index = Allocation.schema.indexes().find(([keys, options]) => keys.planId === 1 && keys.ownerType === 1 && keys.ownerId === 1 && options.unique);
  assert.ok(index);
});

test("achievement confidence is explicit", () => assert.deepEqual(ATTRIBUTION_CONFIDENCE, ["EXACT", "INFERRED", "UNATTRIBUTABLE"]));

test("achievement event has idempotent source event index", () => {
  const index = Achievement.schema.indexes().find(([, options]) => options.name === "uniq_sales_achievement_source_event");
  assert.ok(index); assert.equal(index[1].unique, true); assert.deepEqual(Object.keys(index[0]), ["companyId", "sourceType", "sourceId", "sourceEvent", "sourceEventVersion"]);
});

test("achievement event persists immutable transaction-time rollup snapshots", () => {
  ["amount", "occurredAt", "recordedAt", "policyVersion", "confidence", "rollupEligible", "dataQuality", "snapshot.primaryFsdId", "snapshot.rootDistributorId", "snapshot.areaId", "snapshot.branchId", "snapshot.regionId", "snapshot.zoneId"].forEach((field) => assert.ok(Achievement.schema.path(field), field));
  assert.equal(Achievement.schema.path("amount").instance, "Decimal128");
});

