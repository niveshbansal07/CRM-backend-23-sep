const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertCanManageSalesGeography,
  createSalesGeography,
  listSalesGeographyChildren,
  buildSalesGeographyTree,
  getSalesGeographyById,
  updateSalesGeography,
  updateSalesGeographyStatus,
} = require("../src/services/salesGeography.service");
const {
  validateSalesGeographyCreate,
  validateSalesGeographyUpdate,
} = require("../src/validators/salesGeography.validator");

const oid = (suffix) => `64c64c0000000000000000${String(suffix).padStart(2, "0")}`;
const companyA = oid(1);
const companyB = oid(2);
const salesHead = { _id: oid(3), companyId: companyA, role: "sales_head" };

const comparable = (value) => String((value?._id || value) ?? "");
const matches = (record, query) => Object.entries(query).every(([key, value]) => {
  if (key === "$or") return value.some((condition) => matches(record, condition));
  if (value && typeof value === "object" && "$ne" in value) {
    return comparable(record[key]) !== comparable(value.$ne);
  }
  return comparable(record[key]) === comparable(value);
});

const makeRecord = (payload) => ({
  description: "",
  status: "active",
  isActive: true,
  isArchived: false,
  deletedAt: null,
  ...payload,
  async save() {
    this.saveCount = (this.saveCount || 0) + 1;
    return this;
  },
});

const createMemoryModel = (initial = []) => {
  const state = { records: initial, creates: 0, findQueries: [], findOneQueries: [] };
  const model = {
    findOne: async (query) => {
      state.findOneQueries.push(query);
      return state.records.find((record) => matches(record, query)) || null;
    },
    find: async (query) => {
      state.findQueries.push(query);
      return state.records.filter((record) => matches(record, query));
    },
    create: async (payload) => {
      state.creates += 1;
      const record = makeRecord({ _id: oid(10 + state.creates), ...payload });
      state.records.push(record);
      return record;
    },
  };
  return { state, model };
};

const createAudit = () => {
  const entries = [];
  return {
    entries,
    auditFn: async (entry) => {
      entries.push(entry);
      return entry;
    },
  };
};

const createNode = (model, auditFn, payload, user = salesHead) =>
  createSalesGeography({ payload, user, GeographyModel: model, auditFn });

const zonePayload = (overrides = {}) => ({
  type: "ZONE",
  name: "North Zone",
  code: "NORTH",
  parentId: null,
  description: "Northern sales zone",
  ...overrides,
});

test("Sales Head and platform administrators can manage Geography; other roles cannot", () => {
  assert.equal(comparable(assertCanManageSalesGeography(salesHead)), companyA);
  assert.equal(
    comparable(assertCanManageSalesGeography({ _id: oid(4), companyId: companyA, role: "company_admin" })),
    companyA
  );
  assert.equal(
    comparable(assertCanManageSalesGeography({ _id: oid(5), companyId: companyA, role: "super_admin" })),
    companyA
  );

  ["sales_manager", "sales_executive", "hr_head", "hr_manager", "manager", "employee"].forEach((role) => {
    assert.throws(
      () => assertCanManageSalesGeography({ _id: oid(6), companyId: companyA, role }),
      /Only Head of Sales/
    );
  });
});

test("valid Zone to Region to Branch to Area hierarchy is created and audited", async () => {
  const memory = createMemoryModel();
  const audit = createAudit();
  const zone = await createNode(memory.model, audit.auditFn, zonePayload());
  const region = await createNode(memory.model, audit.auditFn, {
    type: "REGION", name: "Western UP Region", code: "WEST_UP", parentId: zone.id,
  });
  const branch = await createNode(memory.model, audit.auditFn, {
    type: "BRANCH", name: "Muzaffarnagar Branch", code: "MUZAFFARNAGAR", parentId: region.id,
  });
  const area = await createNode(memory.model, audit.auditFn, {
    type: "AREA", name: "Budhana Area", code: "BUDHANA", parentId: branch.id,
  });

  assert.equal(area.type, "AREA");
  assert.equal(comparable(area.parentId), comparable(branch.id));
  assert.deepEqual(
    audit.entries.map((entry) => entry.action),
    ["ZONE_CREATED", "REGION_CREATED", "BRANCH_CREATED", "AREA_CREATED"]
  );
  assert.equal(audit.entries.every((entry) => comparable(entry.companyId) === companyA), true);
  assert.equal(audit.entries.every((entry) => comparable(entry.actorId) === comparable(salesHead._id)), true);
});

test("Zone States are exclusive and Region/Branch persist State and District mappings", async () => {
  const memory = createMemoryModel();
  const audit = createAudit();
  const zone = await createNode(memory.model, audit.auditFn, zonePayload({ stateNames: ["Uttar Pradesh", "Delhi"] }));
  const region = await createNode(memory.model, audit.auditFn, {
    type: "REGION", name: "Uttar Pradesh", code: "UP", parentId: zone.id,
  });
  const branch = await createNode(memory.model, audit.auditFn, {
    type: "BRANCH", name: "Lucknow", code: "LUCKNOW", parentId: region.id,
  });

  assert.deepEqual(zone.stateNames, ["Uttar Pradesh", "Delhi"]);
  assert.equal(region.stateName, "Uttar Pradesh");
  assert.equal(branch.stateName, "Uttar Pradesh");
  assert.equal(branch.districtName, "Lucknow");
  await assert.rejects(
    createNode(memory.model, audit.auditFn, zonePayload({ name: "East Zone", code: "EAST", stateNames: ["Delhi"] })),
    /already mapped to another Zone/
  );
});

test("all invalid parent type combinations are rejected before create or audit", async () => {
  const zone = makeRecord({
    _id: oid(20), companyId: companyA, type: "ZONE", name: "North", normalizedName: "north", code: "NORTH", parentId: null,
  });
  const region = makeRecord({
    _id: oid(21), companyId: companyA, type: "REGION", name: "West", normalizedName: "west", code: "WEST", parentId: zone._id,
  });
  const branch = makeRecord({
    _id: oid(22), companyId: companyA, type: "BRANCH", name: "Main", normalizedName: "main", code: "MAIN", parentId: region._id,
  });
  const memory = createMemoryModel([zone, region, branch]);
  const audit = createAudit();

  const invalid = [
    zonePayload({ parentId: region._id }),
    { type: "REGION", name: "Bad Region", code: "BAD_R", parentId: region._id },
    { type: "REGION", name: "Bad Region 2", code: "BAD_R2", parentId: branch._id },
    { type: "BRANCH", name: "Bad Branch", code: "BAD_B", parentId: zone._id },
    { type: "AREA", name: "Bad Area", code: "BAD_A", parentId: region._id },
    { type: "AREA", name: "Bad Area 2", code: "BAD_A2", parentId: zone._id },
  ];

  for (const payload of invalid) {
    await assert.rejects(
      createNode(memory.model, audit.auditFn, payload),
      /parent|not found/i
    );
  }
  assert.equal(memory.state.creates, 0);
  assert.equal(audit.entries.length, 0);
});

test("cross-company and inactive parents are unavailable without tenant leakage", async () => {
  const otherCompanyZone = makeRecord({
    _id: oid(30), companyId: companyB, type: "ZONE", name: "Other", normalizedName: "other", code: "OTHER", parentId: null,
  });
  const inactiveZone = makeRecord({
    _id: oid(31), companyId: companyA, type: "ZONE", name: "Inactive", normalizedName: "inactive", code: "INACTIVE", parentId: null,
    status: "inactive", isActive: false,
  });
  const memory = createMemoryModel([otherCompanyZone, inactiveZone]);
  const audit = createAudit();

  await assert.rejects(
    createNode(memory.model, audit.auditFn, { type: "REGION", name: "Private", code: "PRIVATE", parentId: otherCompanyZone._id }),
    /Active ZONE parent not found/
  );
  await assert.rejects(
    createNode(memory.model, audit.auditFn, { type: "REGION", name: "Inactive Child", code: "INACTIVE_CHILD", parentId: inactiveZone._id }),
    /Active ZONE parent not found/
  );
  assert.equal(audit.entries.length, 0);
  assert.equal(memory.state.findOneQueries.every((query) => comparable(query.companyId) === companyA), true);
});

test("normalized names and codes are unique only within their company and parent scope", async () => {
  const memory = createMemoryModel();
  const audit = createAudit();
  const north = await createNode(memory.model, audit.auditFn, zonePayload());
  await assert.rejects(
    createNode(memory.model, audit.auditFn, zonePayload({ name: "  north   zone ", code: "NORTH_2" })),
    /already exists/
  );
  await assert.rejects(
    createNode(memory.model, audit.auditFn, zonePayload({ name: "Different Zone", code: " north " })),
    /already exists/
  );

  const south = await createNode(memory.model, audit.auditFn, zonePayload({ name: "South Zone", code: "SOUTH" }));
  await createNode(memory.model, audit.auditFn, {
    type: "REGION", name: "Central Region", code: "CENTRAL", parentId: north.id,
  });
  await createNode(memory.model, audit.auditFn, {
    type: "REGION", name: "Central Region", code: "CENTRAL", parentId: south.id,
  });
  assert.equal(memory.state.records.filter((record) => record.type === "REGION").length, 2);
});

test("tree is built from one company-scoped query without N+1 reads", async () => {
  const zone = makeRecord({ _id: oid(40), companyId: companyA, type: "ZONE", name: "North", normalizedName: "north", code: "NORTH", parentId: null });
  const region = makeRecord({ _id: oid(41), companyId: companyA, type: "REGION", name: "West", normalizedName: "west", code: "WEST", parentId: zone._id });
  const branch = makeRecord({ _id: oid(42), companyId: companyA, type: "BRANCH", name: "Main", normalizedName: "main", code: "MAIN", parentId: region._id });
  const area = makeRecord({ _id: oid(43), companyId: companyA, type: "AREA", name: "Market", normalizedName: "market", code: "MARKET", parentId: branch._id });
  const other = makeRecord({ _id: oid(44), companyId: companyB, type: "ZONE", name: "Private", normalizedName: "private", code: "PRIVATE", parentId: null });
  const memory = createMemoryModel([zone, region, branch, area, other]);

  const tree = await buildSalesGeographyTree({ user: salesHead, GeographyModel: memory.model });
  assert.equal(memory.state.findQueries.length, 1);
  assert.equal(memory.state.findOneQueries.length, 0);
  assert.equal(memory.state.findQueries[0].companyId, companyA);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].regions[0].branches[0].areas[0].name, "Market");
});

test("flat lookups enforce expected parent type, company, and active status", async () => {
  const zone = makeRecord({ _id: oid(50), companyId: companyA, type: "ZONE", name: "North", normalizedName: "north", code: "NORTH", parentId: null });
  const region = makeRecord({ _id: oid(51), companyId: companyA, type: "REGION", name: "West", normalizedName: "west", code: "WEST", parentId: zone._id });
  const inactiveRegion = makeRecord({ _id: oid(52), companyId: companyA, type: "REGION", name: "Old", normalizedName: "old", code: "OLD", parentId: zone._id, status: "inactive", isActive: false });
  const memory = createMemoryModel([zone, region, inactiveRegion]);

  const rows = await listSalesGeographyChildren({
    user: salesHead, parentId: zone._id, parentType: "ZONE", childType: "REGION", GeographyModel: memory.model,
  });
  assert.deepEqual(rows.map((item) => item.name), ["West"]);
  await assert.rejects(
    listSalesGeographyChildren({
      user: salesHead, parentId: zone._id, parentType: "ZONE", childType: "AREA", GeographyModel: memory.model,
    }),
    /Invalid Sales Geography lookup relationship/
  );
});

test("parents with active children cannot be deactivated while leaf Area can", async () => {
  const zone = makeRecord({ _id: oid(60), companyId: companyA, type: "ZONE", name: "North", normalizedName: "north", code: "NORTH", parentId: null });
  const region = makeRecord({ _id: oid(61), companyId: companyA, type: "REGION", name: "West", normalizedName: "west", code: "WEST", parentId: zone._id });
  const branch = makeRecord({ _id: oid(62), companyId: companyA, type: "BRANCH", name: "Main", normalizedName: "main", code: "MAIN", parentId: region._id });
  const area = makeRecord({ _id: oid(63), companyId: companyA, type: "AREA", name: "Market", normalizedName: "market", code: "MARKET", parentId: branch._id });
  const memory = createMemoryModel([zone, region, branch, area]);
  const audit = createAudit();

  for (const record of [zone, region, branch]) {
    await assert.rejects(
      updateSalesGeographyStatus({ id: record._id, status: "inactive", user: salesHead, GeographyModel: memory.model, auditFn: audit.auditFn }),
      /cannot be deactivated/
    );
  }
  assert.equal(audit.entries.length, 0);

  await updateSalesGeographyStatus({ id: area._id, status: "inactive", user: salesHead, GeographyModel: memory.model, auditFn: audit.auditFn });
  assert.equal(area.status, "inactive");
  assert.equal(audit.entries[0].action, "AREA_STATUS_CHANGED");
});

test("child reactivation requires active parent and correct ordering", async () => {
  const zone = makeRecord({ _id: oid(70), companyId: companyA, type: "ZONE", name: "North", normalizedName: "north", code: "NORTH", parentId: null });
  const region = makeRecord({ _id: oid(71), companyId: companyA, type: "REGION", name: "West", normalizedName: "west", code: "WEST", parentId: zone._id });
  const branch = makeRecord({ _id: oid(72), companyId: companyA, type: "BRANCH", name: "Main", normalizedName: "main", code: "MAIN", parentId: region._id, status: "inactive", isActive: false });
  const area = makeRecord({ _id: oid(73), companyId: companyA, type: "AREA", name: "Market", normalizedName: "market", code: "MARKET", parentId: branch._id, status: "inactive", isActive: false });
  const memory = createMemoryModel([zone, region, branch, area]);
  const audit = createAudit();

  await assert.rejects(
    updateSalesGeographyStatus({ id: area._id, status: "active", user: salesHead, GeographyModel: memory.model, auditFn: audit.auditFn }),
    /Active BRANCH parent not found/
  );
  await updateSalesGeographyStatus({ id: branch._id, status: "active", user: salesHead, GeographyModel: memory.model, auditFn: audit.auditFn });
  await updateSalesGeographyStatus({ id: area._id, status: "active", user: salesHead, GeographyModel: memory.model, auditFn: audit.auditFn });
  assert.equal(branch.status, "active");
  assert.equal(area.status, "active");
});

test("safe metadata edit is tenant-scoped, audited, and never changes code or parent", async () => {
  const zone = makeRecord({ _id: oid(80), companyId: companyA, type: "ZONE", name: "North", normalizedName: "north", code: "NORTH", parentId: null });
  const privateZone = makeRecord({ _id: oid(81), companyId: companyB, type: "ZONE", name: "Private", normalizedName: "private", code: "PRIVATE", parentId: null });
  const memory = createMemoryModel([zone, privateZone]);
  const audit = createAudit();

  await updateSalesGeography({
    id: zone._id,
    payload: { name: "Northern Zone", description: "Updated", code: "CHANGED", parentId: oid(82) },
    user: salesHead,
    GeographyModel: memory.model,
    auditFn: audit.auditFn,
  });
  assert.equal(zone.name, "Northern Zone");
  assert.equal(zone.code, "NORTH");
  assert.equal(zone.parentId, null);
  assert.equal(audit.entries[0].action, "ZONE_UPDATED");

  await assert.rejects(
    updateSalesGeography({ id: privateZone._id, payload: { name: "Leaked" }, user: salesHead, GeographyModel: memory.model, auditFn: audit.auditFn }),
    /not found/
  );
  assert.equal(privateZone.name, "Private");
});

test("cross-company records cannot be read or have status changed", async () => {
  const privateBranch = makeRecord({
    _id: oid(83), companyId: companyB, type: "BRANCH", name: "Private Branch",
    normalizedName: "private branch", code: "PRIVATE_BRANCH", parentId: oid(84),
  });
  const memory = createMemoryModel([privateBranch]);
  const audit = createAudit();

  await assert.rejects(
    getSalesGeographyById({ id: privateBranch._id, user: salesHead, GeographyModel: memory.model }),
    /not found/
  );
  await assert.rejects(
    updateSalesGeographyStatus({
      id: privateBranch._id,
      status: "inactive",
      user: salesHead,
      GeographyModel: memory.model,
      auditFn: audit.auditFn,
    }),
    /not found/
  );
  assert.equal(privateBranch.status, "active");
  assert.equal(audit.entries.length, 0);
  assert.equal(memory.state.findOneQueries.every((query) => comparable(query.companyId) === companyA), true);
});

const runValidator = (middleware, { body = {}, params = {} } = {}) => new Promise((resolve) => {
  const req = { body, params };
  const result = { statusCode: null, payload: null, req, nextCalled: false };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(payload) { result.payload = payload; resolve(result); },
  };
  middleware(req, res, () => {
    result.nextCalled = true;
    resolve(result);
  });
});

test("validators reject client authority fields and immutable parent/code/type edits", async () => {
  const createResult = await runValidator(validateSalesGeographyCreate, {
    body: { ...zonePayload(), companyId: companyB, createdBy: oid(90) },
  });
  assert.equal(createResult.statusCode, 400);
  assert.match(createResult.payload.errors.join(" "), /Client-controlled fields/);

  const updateResult = await runValidator(validateSalesGeographyUpdate, {
    body: { name: "Moved", type: "REGION", code: "MOVED", parentId: oid(91) },
  });
  assert.equal(updateResult.statusCode, 400);
  assert.match(updateResult.payload.errors.join(" "), /cannot be changed/);
});
