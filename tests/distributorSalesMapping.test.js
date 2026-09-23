const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildInitialDistributorMappingPreview,
  applyInitialDistributorMapping,
  listEligiblePrimaryFsds,
  validatePrimaryFsd,
  evaluateCurrentMapping,
  assertDistributorAccountMutationAllowed,
} = require("../src/services/distributorSalesMapping.service");

const oid = (suffix) => `86d65d0000000000000000${String(suffix).padStart(2, "0")}`;
const id = (value) => String(value?._id || value?.id || value || "");
const companyA = oid(1);
const companyB = oid(2);
const actor = { _id: oid(3), companyId: companyA, role: "sales_head", fullName: "Sales Head" };
const distributorType = { _id: oid(4), companyId: companyA, module: "account", type: "account_type", code: "DISTRIBUTOR", name: "Distributor", isActive: true };
const dealerType = { _id: oid(5), companyId: companyA, module: "account", type: "account_type", code: "DEALER", name: "Dealer", isActive: true };
const salesDepartment = { _id: oid(6), name: "Sales", code: "SALES", normalizedName: "sales" };
const designation = (level, code, role) => ({ _id: oid(10 + level), title: code.replaceAll("_", " "), code, hierarchyLevel: level, mappedRole: role, status: "active" });

const zone = { _id: oid(20), id: oid(20), companyId: companyA, type: "ZONE", name: "North", code: "NORTH", status: "active", isActive: true };
const region = { _id: oid(21), id: oid(21), companyId: companyA, type: "REGION", name: "West", code: "WEST", parentId: zone._id, status: "active", isActive: true };
const branch = { _id: oid(22), id: oid(22), companyId: companyA, type: "BRANCH", name: "Main", code: "MAIN", parentId: region._id, status: "active", isActive: true };
const area = { _id: oid(23), id: oid(23), companyId: companyA, type: "AREA", name: "Budhana", code: "BUD", parentId: branch._id, status: "active", isActive: true };
const otherArea = { _id: oid(24), id: oid(24), companyId: companyA, type: "AREA", name: "Khatauli", code: "KHA", parentId: branch._id, status: "active", isActive: true };
const pathFor = (target = area) => ({
  target,
  records: [zone, region, branch, target],
  path: { zone, region, branch, area: target },
});

const makeEmployee = (level, suffix, overrides = {}) => {
  const roles = { 1: "sales_executive", 2: "sales_manager", 3: "sales_manager", 4: "sales_manager", 5: "sales_manager", 6: "sales_head" };
  const codes = { 1: "FIELD_SALES_EXECUTIVE", 2: "AREA_SALES_MANAGER", 3: "BRANCH_MANAGER", 4: "REGIONAL_SALES_MANAGER", 5: "ZONAL_SALES_MANAGER", 6: "HEAD_OF_SALES" };
  return {
    _id: oid(suffix), companyId: companyA, fullName: `Employee L${level}`, employeeId: `EMP-${suffix}`,
    role: roles[level], systemRole: roles[level], status: "active", deletedAt: null,
    departmentId: salesDepartment, designationId: designation(level, codes[level], roles[level]),
    reportingManagerId: null, managerId: null, ...overrides,
  };
};

const head = makeEmployee(6, 30);
const zsm = makeEmployee(5, 31, { reportingManagerId: head._id });
const rsm = makeEmployee(4, 32, { reportingManagerId: zsm._id });
const branchManager = makeEmployee(3, 33, { reportingManagerId: rsm._id });
const asm = makeEmployee(2, 34, { reportingManagerId: branchManager._id });
const fsd = makeEmployee(1, 35, { fullName: "Amit FSD", reportingManagerId: asm._id });

const contextFor = (employee, overrides = {}) => ({
  employee,
  department: salesDepartment,
  designation: employee.designationId,
  identity: {
    valid: true,
    hierarchyLevel: employee.designationId.hierarchyLevel,
    technicalRole: employee.designationId.mappedRole,
    designation: { id: employee.designationId._id, title: employee.designationId.title, code: employee.designationId.code },
    ...overrides,
  },
});

const fakeSession = () => ({
  started: false, committed: false, aborted: false,
  startTransaction() { this.started = true; },
  async commitTransaction() { this.committed = true; },
  async abortTransaction() { this.aborted = true; },
  async endSession() {},
});

const matches = (record, query) => Object.entries(query).every(([key, expected]) => {
  if (key === "$or") return expected.some((item) => matches(record, item));
  if (expected && typeof expected === "object" && "$in" in expected) {
    return expected.$in.some((value) => id(value) === id(record[key]));
  }
  return id(record[key]) === id(expected);
});

const model = (records) => ({
  findOne(query) { return Promise.resolve(records.find((record) => matches(record, query)) || null); },
  find(query) { return Promise.resolve(records.filter((record) => matches(record, query))); },
});

const createFixture = ({
  accountType = distributorType,
  assignedTo = null,
  accountStatus = "prospect",
  fsdArea = area,
  fsdEmployee = fsd,
  includeSupervisors = true,
  companyId = companyA,
} = {}) => {
  const account = {
    _id: oid(40), companyId, name: "North Distributor", accountTypeId: accountType,
    status: accountStatus, assignedTo, reportingManagerId: null, distributorBusinessId: null,
    deletedAt: null, $locals: {},
    async save() { this.saveCount = (this.saveCount || 0) + 1; return this; },
    toObject() { return { ...this }; },
  };
  const accounts = [account];
  const employeeAssignments = [{
    _id: oid(50), companyId: companyA, employeeId: fsdEmployee._id, geographyId: fsdArea._id,
    geographyType: "AREA", hierarchyLevel: 1, isCurrent: true, isResponsibleManager: false, deletedAt: null,
  }];
  if (includeSupervisors) {
    employeeAssignments.push(
      { _id: oid(51), companyId: companyA, employeeId: asm._id, geographyId: area._id, hierarchyLevel: 2, isCurrent: true, isResponsibleManager: true, deletedAt: null },
      { _id: oid(52), companyId: companyA, employeeId: branchManager._id, geographyId: branch._id, hierarchyLevel: 3, isCurrent: true, isResponsibleManager: true, deletedAt: null },
      { _id: oid(53), companyId: companyA, employeeId: rsm._id, geographyId: region._id, hierarchyLevel: 4, isCurrent: true, isResponsibleManager: true, deletedAt: null },
      { _id: oid(54), companyId: companyA, employeeId: zsm._id, geographyId: zone._id, hierarchyLevel: 5, isCurrent: true, isResponsibleManager: true, deletedAt: null },
    );
  }
  const users = [head, zsm, rsm, branchManager, asm, fsdEmployee];
  const mappings = [];
  const audits = [];
  const sequenceCalls = [];
  const session = fakeSession();
  const dependencies = {
    Account: model(accounts),
    CrmMaster: model([distributorType, dealerType]),
    User: model(users),
    EmployeeAssignment: model(employeeAssignments),
    DistributorMapping: {
      ...model(mappings),
      async create(values) {
        const created = values.map((value, index) => ({ _id: oid(70 + mappings.length + index), deletedAt: null, ...value }));
        mappings.push(...created);
        return created;
      },
    },
    loadGeographyPath: async ({ geographyId, companyId: requestedCompany }) => {
      if (id(requestedCompany) !== id(companyA)) throw Object.assign(new Error("not found"), { statusCode: 404 });
      if (id(geographyId) === id(area._id)) return pathFor(area);
      if (id(geographyId) === id(otherArea._id)) return pathFor(otherArea);
      throw Object.assign(new Error("not found"), { statusCode: 404 });
    },
    findEmployeeContext: async ({ employeeId, companyId: requestedCompany }) => {
      const employee = users.find((item) => id(item._id) === id(employeeId) && id(item.companyId) === id(requestedCompany));
      if (!employee) throw Object.assign(new Error("employee not found"), { statusCode: 404 });
      return contextFor(employee);
    },
    findCurrentAssignment: async ({ employeeId }) => employeeAssignments.find((item) => (
      id(item.employeeId) === id(employeeId) && item.isCurrent && !item.deletedAt
    )) || null,
    allocateDistributorBusinessId: async (input) => { sequenceCalls.push(input); return "DIST-000001"; },
    writeAuditLog: async (entry) => { audits.push(entry); return entry; },
    startSession: async () => session,
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    newOperationId: () => oid(80),
  };
  return { account, accounts, mappings, audits, sequenceCalls, session, dependencies, employeeAssignments, users };
};

const payload = { accountId: oid(40), areaId: area._id, primaryFsdId: fsd._id, reason: "Initial territory ownership" };

test("initial Distributor preview is zero-write and derives the complete ownership chain", async () => {
  const fixture = createFixture();
  const preview = await buildInitialDistributorMappingPreview({ payload, user: actor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, true);
  assert.equal(preview.proposed.geography.area.name, "Budhana");
  assert.equal(preview.proposed.geography.branch.name, "Main");
  assert.equal(preview.proposed.primaryFsd.fullName, "Amit FSD");
  assert.equal(preview.proposed.supervisoryOwnership.asm.id, asm._id);
  assert.equal(preview.proposed.supervisoryOwnership.headOfSales.id, head._id);
  assert.equal(fixture.mappings.length, 0);
  assert.equal(fixture.account.saveCount, undefined);
  assert.equal(fixture.audits.length, 0);
});

test("eligible Primary FSD candidates are Area-scoped L1 employees with reporting context", async () => {
  const fixture = createFixture();
  const candidates = await listEligiblePrimaryFsds({ areaId: area._id, user: actor, dependencies: fixture.dependencies });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, fsd._id);
  assert.equal(candidates[0].hierarchyLevel, 1);
  assert.equal(candidates[0].area.name, "Budhana");
  assert.equal(candidates[0].reportingManager.fullName, asm.fullName);
});

test("apply atomically creates initial mapping, mirrors assignedTo, allocates ID, activates, and audits", async () => {
  const fixture = createFixture();
  const result = await applyInitialDistributorMapping({
    payload: { ...payload, activateAfterMapping: true },
    user: actor,
    dependencies: fixture.dependencies,
  });
  assert.equal(result.applied, true);
  assert.equal(fixture.mappings.length, 1);
  assert.equal(fixture.mappings[0].primaryFsdId, fsd._id);
  assert.equal(fixture.mappings[0].isCurrent, true);
  assert.equal(fixture.account.assignedTo, fsd._id);
  assert.equal(fixture.account.reportingManagerId, asm._id);
  assert.equal(fixture.account.distributorBusinessId, "DIST-000001");
  assert.equal(fixture.account.status, "active");
  assert.equal(fixture.audits[0].action, "DISTRIBUTOR_SALES_MAPPING_CREATED");
  assert.deepEqual(fixture.audits[0].metadata.effects, [
    "DISTRIBUTOR_PRIMARY_FSD_INITIALIZED",
    "DISTRIBUTOR_ACTIVATED_AFTER_MAPPING",
  ]);
  assert.equal(fixture.audits[0].metadata.accountAssignedToSynchronized, true);
  assert.equal(fixture.session.committed, true);
});

test("existing different Account assignee is an explicit blocking conflict", async () => {
  const fixture = createFixture({ assignedTo: asm });
  const preview = await buildInitialDistributorMappingPreview({ payload, user: actor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, false);
  assert.ok(preview.blockers.includes("EXISTING_ASSIGNEE_CONFLICT"));
  assert.equal(fixture.account.assignedTo._id, asm._id);
});

test("wrong Account type cannot receive a Distributor Sales mapping", async () => {
  const fixture = createFixture({ accountType: dealerType });
  await assert.rejects(
    buildInitialDistributorMappingPreview({ payload, user: actor, dependencies: fixture.dependencies }),
    /canonical DISTRIBUTOR/
  );
});

test("wrong FSD Area is blocked", async () => {
  const fixture = createFixture({ fsdArea: otherArea });
  await assert.rejects(
    buildInitialDistributorMappingPreview({ payload, user: actor, dependencies: fixture.dependencies }),
    /Geography must match/
  );
});

test("wrong FSD level and inactive FSD are blocked", async () => {
  const wrongLevel = makeEmployee(2, 60);
  const levelFixture = createFixture({ fsdEmployee: wrongLevel });
  await assert.rejects(
    validatePrimaryFsd({ fsdId: wrongLevel._id, areaId: area._id, companyId: companyA, dependencies: levelFixture.dependencies }),
    /structured L1/
  );
  const inactive = { ...fsd, status: "disabled" };
  const inactiveFixture = createFixture({ fsdEmployee: inactive });
  await assert.rejects(
    validatePrimaryFsd({ fsdId: inactive._id, areaId: area._id, companyId: companyA, dependencies: inactiveFixture.dependencies }),
    /must be active/
  );
});

test("one FSD may own multiple Distributors while each Distributor gets only one current mapping", async () => {
  const fixtureA = createFixture();
  await applyInitialDistributorMapping({ payload, user: actor, dependencies: fixtureA.dependencies });
  const fixtureB = createFixture();
  fixtureB.account._id = oid(41);
  await applyInitialDistributorMapping({
    payload: { ...payload, accountId: fixtureB.account._id },
    user: actor,
    dependencies: fixtureB.dependencies,
  });
  assert.equal(fixtureA.mappings[0].primaryFsdId, fsd._id);
  assert.equal(fixtureB.mappings[0].primaryFsdId, fsd._id);
  await assert.rejects(
    applyInitialDistributorMapping({ payload, user: actor, dependencies: fixtureA.dependencies }),
    /blocking conflicts/
  );
  assert.equal(fixtureA.mappings.length, 1);
});

test("supervisory vacancies warn without blocking a valid Area and FSD mapping", async () => {
  const fixture = createFixture({ includeSupervisors: false });
  const preview = await buildInitialDistributorMappingPreview({ payload, user: actor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, true);
  assert.ok(preview.warnings.includes("ASM_VACANT"));
  assert.equal(preview.proposed.supervisoryOwnership.asm, null);
});

test("tenant isolation rejects an Area or FSD outside the actor company", async () => {
  const fixture = createFixture();
  await assert.rejects(
    buildInitialDistributorMappingPreview({ ...{ payload }, payload: { ...payload, areaId: oid(99) }, user: actor, dependencies: fixture.dependencies }),
    /not found/
  );
  const foreignFsd = { ...fsd, _id: oid(61), companyId: companyB };
  const foreignFixture = createFixture({ fsdEmployee: foreignFsd });
  await assert.rejects(
    validatePrimaryFsd({ fsdId: foreignFsd._id, areaId: area._id, companyId: companyA, dependencies: foreignFixture.dependencies }),
    /employee not found/
  );
});

test("legacy active unmapped Distributor remains active and is reported non-destructively", async () => {
  const fixture = createFixture({ accountStatus: "active" });
  const health = await evaluateCurrentMapping({
    account: fixture.account,
    mapping: null,
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  assert.equal(health.state, "LEGACY_ACTIVE_UNMAPPED");
  assert.equal(fixture.account.status, "active");
  assert.equal(fixture.account.saveCount, undefined);
});

test("mapped ownership cannot be bypassed while non-Distributor generic assignment remains unchanged", async () => {
  const fixture = createFixture();
  fixture.mappings.push({
    _id: oid(72), companyId: companyA, distributorAccountId: fixture.account._id,
    primaryFsdId: fsd._id, geographyId: area._id, isCurrent: true, deletedAt: null,
  });
  await assert.rejects(
    assertDistributorAccountMutationAllowed({
      account: fixture.account,
      proposedData: { assignedTo: asm._id },
      companyId: companyA,
      dependencies: fixture.dependencies,
    }),
    /Phase 5 workflow/
  );
  fixture.account.assignedTo = fsd._id;
  fixture.account.reportingManagerId = asm._id;
  await assert.rejects(
    assertDistributorAccountMutationAllowed({
      account: fixture.account,
      proposedData: { reportingManagerId: branchManager._id },
      companyId: companyA,
      dependencies: fixture.dependencies,
    }),
    /reporting compatibility cannot be changed/
  );
  const dealer = { ...fixture.account, _id: oid(62), accountTypeId: dealerType };
  const allowed = await assertDistributorAccountMutationAllowed({
    account: dealer,
    proposedData: { assignedTo: fsd._id },
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  assert.equal(allowed.willBeDistributor, false);
});

test("mapped Distributor health flags inactive and moved Primary FSD without mutating ownership", async () => {
  const fixture = createFixture();
  const mapping = { distributorAccountId: fixture.account._id, geographyId: area._id, primaryFsdId: fsd._id, isCurrent: true };
  fixture.account.assignedTo = fsd._id;
  fixture.users.find((item) => id(item._id) === id(fsd._id)).status = "disabled";
  const inactive = await evaluateCurrentMapping({ account: fixture.account, mapping, companyId: companyA, dependencies: fixture.dependencies });
  assert.equal(inactive.state, "PRIMARY_FSD_INACTIVE");
  fixture.users.find((item) => id(item._id) === id(fsd._id)).status = "active";
  fixture.employeeAssignments.find((item) => id(item.employeeId) === id(fsd._id)).geographyId = otherArea._id;
  const moved = await evaluateCurrentMapping({ account: fixture.account, mapping, companyId: companyA, dependencies: fixture.dependencies });
  assert.equal(moved.state, "PRIMARY_FSD_GEOGRAPHY_MISMATCH");
  assert.equal(mapping.geographyId, area._id);
});

test("new Distributor activation is blocked without mapping while legacy active unmapped edits remain allowed", async () => {
  const newFixture = createFixture({ accountStatus: "prospect" });
  await assert.rejects(
    assertDistributorAccountMutationAllowed({
      account: newFixture.account,
      proposedData: { status: "active" },
      companyId: companyA,
      dependencies: newFixture.dependencies,
    }),
    /valid Area and Primary FSD mapping before activation/
  );
  const legacyFixture = createFixture({ accountStatus: "active" });
  const allowed = await assertDistributorAccountMutationAllowed({
    account: legacyFixture.account,
    proposedData: { city: "Updated city" },
    companyId: companyA,
    dependencies: legacyFixture.dependencies,
  });
  assert.equal(allowed.mapping, null);
  assert.equal(legacyFixture.account.status, "active");
});
