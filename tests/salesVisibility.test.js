const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SALES_VISIBILITY_SCOPE,
  SALES_VISIBILITY_STATUS,
  andFilters,
  resolveSalesVisibilityContext,
  resolveAccessibleAccountScope,
  buildLeadVisibilityFilter,
  buildOrderVisibilityFilter,
  buildVisitVisibilityFilter,
  buildFollowUpVisibilityFilter,
  assertEmployeeWithinVisibility,
} = require("../src/services/salesVisibility.service");

const id = (value) => String(value?._id || value?.id || value || "");
const eq = (left, right) => id(left) === id(right);
const valueMatches = (actual, expected) => {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$in" in expected) return expected.$in.some((item) => eq(actual, item));
    if ("$nin" in expected) return !expected.$nin.some((item) => eq(actual, item));
    if ("$ne" in expected) return !eq(actual, expected.$ne);
  }
  return eq(actual, expected);
};
const matches = (record, filter = {}) => Object.entries(filter).every(([key, expected]) => {
  if (key === "$and") return expected.every((item) => matches(record, item));
  if (key === "$or") return expected.some((item) => matches(record, item));
  return valueMatches(record[key], expected);
});

const query = (value) => ({
  select() { return this; },
  lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const model = (records) => ({
  records,
  find: (filter) => query(records.filter((record) => matches(record, filter))),
  findOne: (filter) => query(records.find((record) => matches(record, filter)) || null),
});

const company = "company-a";
const otherCompany = "company-b";
const geo = (key, type, parentId = null) => ({
  _id: key, companyId: company, type, parentId, name: key, code: key.toUpperCase(),
  status: "active", isActive: true, isArchived: false, deletedAt: null,
});
const geographies = [
  geo("zone-n", "ZONE"), geo("zone-s", "ZONE"),
  geo("region-nw", "REGION", "zone-n"), geo("region-ne", "REGION", "zone-n"),
  geo("region-s", "REGION", "zone-s"),
  geo("branch-a", "BRANCH", "region-nw"), geo("branch-b", "BRANCH", "region-nw"),
  geo("branch-ne", "BRANCH", "region-ne"), geo("branch-s", "BRANCH", "region-s"),
  geo("area-1", "AREA", "branch-a"), geo("area-2", "AREA", "branch-a"),
  geo("area-3", "AREA", "branch-b"), geo("area-ne", "AREA", "branch-ne"),
  geo("area-s", "AREA", "branch-s"),
];

const designation = (level) => ({
  _id: `designation-${level}`,
  hierarchyLevel: level,
  mappedRole: level === 1 ? "sales_executive" : level === 6 ? "sales_head" : "sales_manager",
  status: "active",
  isArchived: false,
});
const actor = (key, level, geographyId = null, role = null) => ({
  _id: key,
  companyId: company,
  role: role || (level === 1 ? "sales_executive" : level === 6 ? "sales_head" : "sales_manager"),
  systemRole: role || (level === 1 ? "sales_executive" : level === 6 ? "sales_head" : "sales_manager"),
  designationId: designation(level),
  status: "active",
  deletedAt: null,
  geographyId,
});

const users = [
  actor("head", 6), actor("zsm-n", 5, "zone-n"), actor("zsm-s", 5, "zone-s"),
  actor("rsm-nw", 4, "region-nw"), actor("rsm-ne", 4, "region-ne"),
  actor("bm-a", 3, "branch-a"), actor("bm-b", 3, "branch-b"),
  actor("asm-1", 2, "area-1"), actor("asm-2", 2, "area-2"), actor("asm-3", 2, "area-3"),
  actor("fsd-1", 1, "area-1"), actor("fsd-2", 1, "area-2"), actor("fsd-3", 1, "area-3"),
  actor("fsd-ne", 1, "area-ne"), actor("fsd-s", 1, "area-s"),
];
const geographyTypeFor = (level) => ({ 1: "AREA", 2: "AREA", 3: "BRANCH", 4: "REGION", 5: "ZONE" }[level]);
const assignments = users.filter((user) => user.designationId.hierarchyLevel < 6).map((user) => ({
  _id: `assignment-${user._id}`,
  companyId: company,
  employeeId: user._id,
  hierarchyLevel: user.designationId.hierarchyLevel,
  geographyId: user.geographyId,
  geographyType: geographyTypeFor(user.designationId.hierarchyLevel),
  assignmentType: "PRIMARY",
  status: "current",
  isCurrent: true,
  deletedAt: null,
}));

const masters = ["DISTRIBUTOR", "DEALER", "RETAILER", "CUSTOMER"].map((code) => ({
  _id: `type-${code.toLowerCase()}`,
  companyId: company,
  module: "account",
  type: "account_type",
  code,
  isActive: true,
}));
const typeId = (code) => `type-${code.toLowerCase()}`;
const account = (key, type, values = {}) => ({
  _id: key, companyId: company, accountTypeId: typeId(type), parentAccountId: null,
  assignedTo: null, createdBy: null, deletedAt: null, ...values,
});
const accounts = [
  account("dist-1", "DISTRIBUTOR", { assignedTo: "fsd-1" }),
  account("dealer-1", "DEALER", { parentAccountId: "dist-1" }),
  account("retailer-1", "RETAILER", { parentAccountId: "dist-1" }),
  account("customer-1", "CUSTOMER", { parentAccountId: "dealer-1" }),
  account("customer-retailer-1", "CUSTOMER", { parentAccountId: "retailer-1" }),
  account("legacy-direct-customer", "CUSTOMER", { parentAccountId: "dist-1" }),
  account("dist-2", "DISTRIBUTOR", { assignedTo: "fsd-2" }),
  account("dealer-2", "DEALER", { parentAccountId: "dist-2", assignedTo: "fsd-1" }),
  account("customer-2", "CUSTOMER", { parentAccountId: "dealer-2" }),
  account("dist-3", "DISTRIBUTOR", { assignedTo: "fsd-s" }),
  account("dealer-3", "DEALER", { parentAccountId: "dist-3" }),
  account("legacy-dealer", "DEALER", { assignedTo: "fsd-1" }),
  account("corporate-1", "OTHER", { accountTypeId: "type-corporate", assignedTo: "fsd-1" }),
  account("corporate-2", "OTHER", { accountTypeId: "type-corporate", assignedTo: "fsd-2" }),
];
const distributorAssignments = [
  { _id: "map-1", companyId: company, distributorAccountId: "dist-1", geographyId: "area-1", primaryFsdId: "fsd-1", status: "current", isCurrent: true, deletedAt: null },
  { _id: "map-2", companyId: company, distributorAccountId: "dist-2", geographyId: "area-2", primaryFsdId: "fsd-2", status: "current", isCurrent: true, deletedAt: null },
  { _id: "map-3", companyId: company, distributorAccountId: "dist-3", geographyId: "area-s", primaryFsdId: "fsd-s", status: "current", isCurrent: true, deletedAt: null },
];

const dependencies = {
  User: model(users),
  Designation: model([]),
  SalesGeography: model(geographies),
  EmployeeAssignment: model(assignments),
  DistributorAssignment: model(distributorAssignments),
  Account: model(accounts),
  CrmMaster: model(masters),
};
const contextFor = (key) => resolveSalesVisibilityContext({
  user: users.find((item) => item._id === key), companyId: company, dependencies,
});

test("L1 resolves OWN_ASSIGNED and never expands to Area employees", async () => {
  const context = await contextFor("fsd-1");
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.OWN_ASSIGNED);
  assert.deepEqual(context.accessibleEmployeeIds, ["fsd-1"]);
  assert.deepEqual(context.descendantAreaIds, ["area-1"]);
});

test("L2 resolves only its Area employees", async () => {
  const context = await contextFor("asm-1");
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.AREA);
  assert.deepEqual(new Set(context.accessibleEmployeeIds), new Set(["asm-1", "fsd-1"]));
  assert.ok(!context.accessibleEmployeeIds.includes("fsd-2"));
});

test("L3 resolves Branch and all descendant Areas", async () => {
  const context = await contextFor("bm-a");
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.BRANCH);
  assert.deepEqual(new Set(context.descendantAreaIds), new Set(["area-1", "area-2"]));
  assert.ok(context.accessibleEmployeeIds.includes("fsd-1"));
  assert.ok(context.accessibleEmployeeIds.includes("fsd-2"));
  assert.ok(!context.accessibleEmployeeIds.includes("fsd-3"));
});

test("L4 resolves Region but not another Region in the same Zone", async () => {
  const context = await contextFor("rsm-nw");
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.REGION);
  assert.ok(context.descendantAreaIds.includes("area-3"));
  assert.ok(!context.descendantAreaIds.includes("area-ne"));
});

test("L5 resolves Zone but not another Zone", async () => {
  const context = await contextFor("zsm-n");
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.ZONE);
  assert.ok(context.descendantAreaIds.includes("area-ne"));
  assert.ok(!context.descendantAreaIds.includes("area-s"));
});

test("L2-L5 share sales_manager but receive four distinct business scopes", async () => {
  const contexts = await Promise.all(["asm-1", "bm-a", "rsm-nw", "zsm-n"].map(contextFor));
  assert.deepEqual(contexts.map((item) => item.technicalRole), Array(4).fill("sales_manager"));
  assert.deepEqual(contexts.map((item) => item.scopeType), ["AREA", "BRANCH", "REGION", "ZONE"]);
});

test("L6 is company Sales scoped without a Geography assignment", async () => {
  const context = await contextFor("head");
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.COMPANY_SALES);
  assert.equal(context.hierarchyLevel, 6);
  assert.ok(context.accessibleEmployeeIds.includes("fsd-s"));
});

test("Company Admin retains own-company Sales authority", async () => {
  const admin = { _id: "admin", companyId: company, role: "company_admin", status: "active", deletedAt: null };
  const context = await resolveSalesVisibilityContext({ user: admin, companyId: company, dependencies });
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.COMPANY_SALES);
  assert.equal(context.isPlatformAdmin, true);
  assert.ok(context.accessibleEmployeeIds.includes("fsd-s"));
});

test("other Departments receive no Sales authority", async () => {
  const hr = { _id: "hr-1", companyId: company, role: "hr_manager", status: "active", deletedAt: null };
  const context = await resolveSalesVisibilityContext({ user: hr, companyId: company, dependencies });
  assert.equal(context.status, SALES_VISIBILITY_STATUS.NOT_SALES_AUTHORITY);
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.NONE);
});

test("unassigned manager receives no company fallback", async () => {
  const unassigned = actor("unassigned", 3, null);
  dependencies.User.records.push(unassigned);
  const context = await resolveSalesVisibilityContext({ user: unassigned, companyId: company, dependencies });
  assert.equal(context.status, SALES_VISIBILITY_STATUS.NO_ACTIVE_SALES_GEOGRAPHY);
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.NONE);
  assert.deepEqual(context.accessibleEmployeeIds, []);
});

test("ambiguous manager designation receives no scope", async () => {
  const ambiguous = { ...actor("ambiguous", 3, "branch-a"), designationId: { hierarchyLevel: 0, mappedRole: "sales_manager" } };
  dependencies.User.records.push(ambiguous);
  const context = await resolveSalesVisibilityContext({ user: ambiguous, companyId: company, dependencies });
  assert.equal(context.status, SALES_VISIBILITY_STATUS.AMBIGUOUS_SALES_DESIGNATION);
  assert.equal(context.scopeType, SALES_VISIBILITY_SCOPE.NONE);
});

test("company mismatch is rejected before resolving any hierarchy", async () => {
  await assert.rejects(
    () => resolveSalesVisibilityContext({ user: users.find((item) => item._id === "asm-1"), companyId: otherCompany, dependencies }),
    /Company context does not match/
  );
});

test("L1 Distributor and downstream channel visibility follows current Primary FSD", async () => {
  const scope = await resolveAccessibleAccountScope(await contextFor("fsd-1"), { dependencies });
  assert.deepEqual(scope.distributorIds, ["dist-1"]);
  for (const expected of ["dist-1", "dealer-1", "retailer-1", "customer-1", "customer-retailer-1", "legacy-direct-customer"]) {
    assert.ok(scope.channelAccountIds.includes(expected));
  }
  assert.ok(!scope.channelAccountIds.includes("dist-2"));
});

test("manager channel scope follows Distributor Area rather than stale Account assignee", async () => {
  const scope = await resolveAccessibleAccountScope(await contextFor("asm-1"), { dependencies });
  assert.ok(scope.channelAccountIds.includes("dealer-1"));
  assert.ok(!scope.channelAccountIds.includes("dealer-2"));
});

test("legacy unresolved channel Account is visible only by safe direct ownership", async () => {
  const fsdOne = await resolveAccessibleAccountScope(await contextFor("fsd-1"), { dependencies });
  const fsdTwo = await resolveAccessibleAccountScope(await contextFor("fsd-2"), { dependencies });
  assert.ok(fsdOne.unresolvedOwnedIds.includes("legacy-dealer"));
  assert.ok(!fsdTwo.unresolvedOwnedIds.includes("legacy-dealer"));
  assert.ok(!fsdOne.unresolvedOwnedIds.includes("dealer-2"), "valid out-of-scope mapping must beat stale assignedTo");
});

test("non-channel Accounts retain scoped direct ownership", async () => {
  const scope = await resolveAccessibleAccountScope(await contextFor("fsd-1"), { dependencies });
  assert.ok(matches(accounts.find((item) => item._id === "corporate-1"), scope.filter));
  assert.ok(!matches(accounts.find((item) => item._id === "corporate-2"), scope.filter));
});

test("L1 Lead filter permits own records and blocks direct-ID bypass", async () => {
  const filter = buildLeadVisibilityFilter(await contextFor("fsd-1"));
  assert.ok(matches({ _id: "lead-1", assignedTo: "fsd-1", createdBy: "fsd-1" }, filter));
  assert.ok(!matches({ _id: "lead-2", assignedTo: "fsd-2", createdBy: "fsd-2" }, filter));
});

test("outside assignedTo query becomes impossible instead of widening manager Leads", async () => {
  const filter = buildLeadVisibilityFilter(await contextFor("asm-1"), { assignedTo: "fsd-2" });
  assert.ok(!matches({ _id: "lead-2", assignedTo: "fsd-2" }, filter));
});

test("assignee candidates are clamped to Geography-accessible Sales executives", async () => {
  const context = await contextFor("asm-1");
  const allowed = await assertEmployeeWithinVisibility({ context, employeeId: "fsd-1", companyId: company, dependencies });
  assert.equal(allowed._id, "fsd-1");
  await assert.rejects(
    () => assertEmployeeWithinVisibility({ context, employeeId: "fsd-2", companyId: company, dependencies }),
    /outside your Sales visibility scope/
  );
});

test("Order scope prioritizes historical assigned employee", async () => {
  const context = await contextFor("fsd-1");
  const filter = buildOrderVisibilityFilter(context, { accountIds: ["dist-1"] });
  assert.ok(matches({ _id: "order-1", assignedTo: "fsd-1", accountId: "dist-1" }, filter));
  assert.ok(!matches({ _id: "order-2", assignedTo: "fsd-2", accountId: "dist-1", createdBy: "fsd-2" }, filter));
});

test("manager may see unassigned historical Order only through an accessible Account", async () => {
  const context = await contextFor("asm-1");
  const filter = buildOrderVisibilityFilter(context, { accountIds: ["dist-1"] });
  assert.ok(matches({ _id: "order-1", assignedTo: null, accountId: "dist-1" }, filter));
  assert.ok(!matches({ _id: "order-2", assignedTo: null, accountId: "dist-2" }, filter));
});

test("Visit detail and GPS route share executive visibility predicate", async () => {
  const filter = buildVisitVisibilityFilter(await contextFor("asm-1"));
  assert.ok(matches({ _id: "visit-1", executiveId: "fsd-1" }, filter));
  assert.ok(!matches({ _id: "visit-2", executiveId: "fsd-2" }, filter));
});

test("Visit employeeId query cannot request an employee outside Geography", async () => {
  const filter = buildVisitVisibilityFilter(await contextFor("asm-1"), "fsd-2");
  assert.ok(!matches({ _id: "visit-2", executiveId: "fsd-2" }, filter));
});

test("Follow-up scope is employee Geography based and clamps requested employee", async () => {
  const context = await contextFor("bm-a");
  assert.ok(matches({ _id: "follow-1", assignedTo: "fsd-2" }, buildFollowUpVisibilityFilter(context)));
  assert.ok(!matches(
    { _id: "follow-3", assignedTo: "fsd-3" },
    buildFollowUpVisibilityFilter(context, "fsd-3")
  ));
});

test("Primary FSD reassignment immediately changes current channel visibility", async () => {
  const mapping = distributorAssignments.find((item) => item._id === "map-1");
  mapping.primaryFsdId = "fsd-2";
  const oldScope = await resolveAccessibleAccountScope(await contextFor("fsd-1"), { dependencies });
  const newScope = await resolveAccessibleAccountScope(await contextFor("fsd-2"), { dependencies });
  assert.ok(!oldScope.distributorIds.includes("dist-1"));
  assert.ok(newScope.distributorIds.includes("dist-1"));
  mapping.primaryFsdId = "fsd-1";
});

test("cross-Area Distributor transfer moves manager visibility without reparenting Dealer", async () => {
  const mapping = distributorAssignments.find((item) => item._id === "map-1");
  const dealerParent = accounts.find((item) => item._id === "dealer-1").parentAccountId;
  mapping.geographyId = "area-2";
  const areaOne = await resolveAccessibleAccountScope(await contextFor("asm-1"), { dependencies });
  const areaTwo = await resolveAccessibleAccountScope(await contextFor("asm-2"), { dependencies });
  assert.ok(!areaOne.distributorIds.includes("dist-1"));
  assert.ok(areaTwo.distributorIds.includes("dist-1"));
  assert.equal(accounts.find((item) => item._id === "dealer-1").parentAccountId, dealerParent);
  mapping.geographyId = "area-1";
});

test("manager transfer follows current employee Geography with no CRM rewrite", async () => {
  const assignment = assignments.find((item) => item.employeeId === "bm-a");
  assignment.geographyId = "branch-b";
  const context = await contextFor("bm-a");
  assert.deepEqual(context.descendantAreaIds, ["area-3"]);
  assert.ok(context.accessibleEmployeeIds.includes("fsd-3"));
  assert.ok(!context.accessibleEmployeeIds.includes("fsd-1"));
  assignment.geographyId = "branch-a";
});

test("query filters remain database predicates rather than post-load JavaScript filtering", async () => {
  const context = await contextFor("asm-1");
  const filter = andFilters({ companyId: company, deletedAt: null }, buildLeadVisibilityFilter(context));
  assert.ok(Array.isArray(filter.$and));
  assert.ok(JSON.stringify(filter).includes("assignedTo"));
  assert.ok(JSON.stringify(filter).includes("$in"));
});
