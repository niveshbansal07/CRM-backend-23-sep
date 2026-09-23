const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertCanManageAssignments,
  resolveSalesDesignationIdentity,
  loadGeographyPath,
  previewSalesGeographyAssignment,
  assignSalesGeography,
  endCurrentSalesGeographyAssignment,
  getCurrentAssignmentForEmployee,
  getAssignmentHistoryForEmployee,
  evaluateSalesPlacementForEmployee,
  listCompatibleGeographiesForEmployee,
  listSalesAssignmentReadiness,
  buildSalesAssignmentTree,
} = require("../src/services/salesGeographyAssignment.service");

const oid = (suffix) => `65d65d0000000000000000${String(suffix).padStart(2, "0")}`;
const id = (value) => String((value?._id || value) ?? "");
const companyA = oid(1);
const companyB = oid(2);
const actor = { _id: oid(3), companyId: companyA, role: "sales_head" };

const matches = (record, query) => Object.entries(query).every(([key, expected]) => {
  if (key === "$or") return expected.some((condition) => matches(record, condition));
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    if ("$in" in expected) return expected.$in.some((value) => id(value) === id(record[key]));
    if ("$ne" in expected) return id(record[key]) !== id(expected.$ne);
  }
  return id(record[key]) === id(expected);
});

const doc = (payload) => ({
  ...payload,
  async save() { this.saveCount = (this.saveCount || 0) + 1; return this; },
});

const createModel = (records = [], { assignment = false } = {}) => ({
  records,
  findOne(query) { return Promise.resolve(records.find((item) => matches(item, query)) || null); },
  find(query) { return Promise.resolve(records.filter((item) => matches(item, query))); },
  async create(payload) {
    const items = Array.isArray(payload) ? payload : [payload];
    const created = items.map((item, index) => {
      if (assignment && item.isCurrent) {
        const employeeConflict = records.find((record) => (
          record.isCurrent && !record.deletedAt && id(record.companyId) === id(item.companyId) &&
          id(record.employeeId) === id(item.employeeId)
        ));
        const managerConflict = item.isResponsibleManager && records.find((record) => (
          record.isCurrent && record.isResponsibleManager && !record.deletedAt &&
          id(record.companyId) === id(item.companyId) && id(record.geographyId) === id(item.geographyId)
        ));
        if (employeeConflict || managerConflict) {
          const error = new Error("duplicate");
          error.code = 11000;
          throw error;
        }
      }
      const record = doc({
        _id: oid(80 + records.length + index),
        status: item.isCurrent === false ? "ended" : "current",
        isCurrent: item.isCurrent !== false,
        deletedAt: null,
        createdAt: new Date("2026-08-23T09:00:00.000Z"),
        updatedAt: new Date("2026-08-23T09:00:00.000Z"),
        ...item,
      });
      records.push(record);
      return record;
    });
    return Array.isArray(payload) ? created : created[0];
  },
});

const fakeSession = () => ({
  started: false,
  committed: false,
  aborted: false,
  startTransaction() { this.started = true; },
  async commitTransaction() { this.committed = true; },
  async abortTransaction() { this.aborted = true; },
  async endSession() {},
});

const salesDepartment = doc({
  _id: oid(10), companyId: companyA, name: "Sales", normalizedName: "sales", code: "SALES", deletedAt: null,
});
const financeDepartment = doc({
  _id: oid(11), companyId: companyA, name: "Finance", normalizedName: "finance", code: "FIN", deletedAt: null,
});

const definitions = [
  [6, "HEAD_OF_SALES", "Head of Sales", "sales_head"],
  [5, "ZONAL_SALES_MANAGER", "Zonal Sales Manager", "sales_manager"],
  [4, "REGIONAL_SALES_MANAGER", "Regional Sales Manager", "sales_manager"],
  [3, "BRANCH_MANAGER", "Branch Manager", "sales_manager"],
  [2, "AREA_SALES_MANAGER", "Area Sales Manager", "sales_manager"],
  [1, "FIELD_SALES_EXECUTIVE", "Field Sales Executive", "sales_executive"],
];
const designations = definitions.map(([level, code, title, mappedRole], index) => doc({
  _id: oid(20 + index), companyId: companyA, departmentId: salesDepartment._id,
  hierarchyLevel: level, code, title, name: title, mappedRole, deletedAt: null,
}));
const ambiguousDesignation = doc({
  _id: oid(27), companyId: companyA, departmentId: salesDepartment._id,
  hierarchyLevel: 3, code: "", title: "Sales Manager", name: "Sales Manager",
  mappedRole: "sales_manager", deletedAt: null,
});

const employeeForLevel = (level, suffix, overrides = {}) => {
  const designation = designations.find((item) => item.hierarchyLevel === level);
  return doc({
    _id: oid(suffix), companyId: companyA, fullName: `Employee L${level}`,
    employeeId: `EMP-L${level}`, role: designation.mappedRole, systemRole: designation.mappedRole,
    departmentId: salesDepartment._id, department: "Sales", designationId: designation._id,
    designation: designation.title, reportingManagerId: null, status: "active", deletedAt: null,
    ...overrides,
  });
};

const head = employeeForLevel(6, 30);
const zsm = employeeForLevel(5, 31, { reportingManagerId: head._id });
const rsm = employeeForLevel(4, 32, { reportingManagerId: zsm._id });
const branchManager = employeeForLevel(3, 33, { reportingManagerId: rsm._id });
const asm = employeeForLevel(2, 34, { reportingManagerId: branchManager._id });
const fsd = employeeForLevel(1, 35, { reportingManagerId: asm._id });
const fsdTwo = employeeForLevel(1, 36, { reportingManagerId: asm._id, fullName: "Second FSD" });

const zone = doc({ _id: oid(40), companyId: companyA, type: "ZONE", name: "North", code: "NORTH", parentId: null, status: "active", isActive: true, isArchived: false, deletedAt: null });
const region = doc({ _id: oid(41), companyId: companyA, type: "REGION", name: "West", code: "WEST", parentId: zone._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const branch = doc({ _id: oid(42), companyId: companyA, type: "BRANCH", name: "Main", code: "MAIN", parentId: region._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const area = doc({ _id: oid(43), companyId: companyA, type: "AREA", name: "Market", code: "MARKET", parentId: branch._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const otherZone = doc({ _id: oid(44), companyId: companyA, type: "ZONE", name: "South", code: "SOUTH", parentId: null, status: "active", isActive: true, isArchived: false, deletedAt: null });
const otherArea = doc({ _id: oid(45), companyId: companyA, type: "AREA", name: "Other", code: "OTHER", parentId: oid(46), status: "active", isActive: true, isArchived: false, deletedAt: null });

const createFixture = (overrides = {}) => {
  const users = [head, zsm, rsm, branchManager, asm, fsd, fsdTwo].map((item) => doc({ ...item }));
  const assignments = [];
  const audits = [];
  const session = fakeSession();
  const dependencies = {
    User: createModel(users),
    Designation: createModel([...designations, ambiguousDesignation].map((item) => doc({ ...item }))),
    Department: createModel([salesDepartment, financeDepartment].map((item) => doc({ ...item }))),
    Geography: createModel([zone, region, branch, area, otherZone].map((item) => doc({ ...item }))),
    Assignment: createModel(assignments, { assignment: true }),
    writeAuditLog: async (entry) => { audits.push(entry); return entry; },
    startSession: async () => session,
    now: () => new Date("2026-08-23T10:00:00.000Z"),
    ...overrides,
  };
  return { dependencies, users, assignments, audits, session };
};

test("structured L5 through L1 identities map to Zone, Region, Branch, Area, Area while L6 maps to none", () => {
  const expected = { 6: null, 5: "ZONE", 4: "REGION", 3: "BRANCH", 2: "AREA", 1: "AREA" };
  definitions.forEach(([level]) => {
    const designation = designations.find((item) => item.hierarchyLevel === level);
    const result = resolveSalesDesignationIdentity({
      employee: employeeForLevel(level, 60 + level), designation, department: salesDepartment,
    });
    assert.equal(result.valid, true);
    assert.equal(result.expectedGeographyType, expected[level]);
    assert.equal(result.technicalRole, designation.mappedRole);
  });
});

test("ambiguous title-only Sales designation is never guessed", () => {
  const result = resolveSalesDesignationIdentity({ employee: branchManager, designation: ambiguousDesignation, department: salesDepartment });
  assert.equal(result.valid, false);
  assert.equal(result.status, "AMBIGUOUS_DESIGNATION");
});

test("derived Geography path stores one node and resolves all ancestors", async () => {
  const { dependencies } = createFixture();
  const result = await loadGeographyPath({ geographyId: area._id, companyId: companyA, dependencies });
  assert.deepEqual([result.path.zone.id, result.path.region.id, result.path.branch.id, result.path.area.id].map(id), [zone._id, region._id, branch._id, area._id].map(id));
});

test("Sales Head and platform administrators manage assignments; Sales managers and executives cannot", () => {
  assert.equal(id(assertCanManageAssignments(actor)), companyA);
  assert.equal(id(assertCanManageAssignments({ _id: oid(61), companyId: companyA, role: "company_admin" })), companyA);
  assert.equal(id(assertCanManageAssignments({ _id: oid(62), companyId: companyA, role: "super_admin" })), companyA);
  ["sales_manager", "sales_executive", "hr_head", "manager", "employee"].forEach((role) => {
    assert.throws(() => assertCanManageAssignments({ _id: oid(63), companyId: companyA, role }), /Only Head of Sales/);
  });
});

test("preview rejects every wrong level and Geography type combination and L6 assignment", async () => {
  const { dependencies } = createFixture();
  const pairs = [[zsm, region], [rsm, zone], [branchManager, region], [asm, branch], [fsd, region], [head, zone]];
  for (const [employee, geography] of pairs) {
    const preview = await previewSalesGeographyAssignment({ payload: { employeeId: employee._id, geographyId: geography._id, reason: "" }, user: actor, dependencies });
    assert.equal(preview.canApply, false);
  }
});

test("preview performs zero writes and blocked apply creates no assignment or success audit", async () => {
  const fixture = createFixture();
  const preview = await previewSalesGeographyAssignment({
    payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" },
    user: actor,
    dependencies: fixture.dependencies,
  });
  assert.equal(preview.canApply, true);
  assert.equal(fixture.assignments.length, 0);
  assert.equal(fixture.audits.length, 0);

  await assert.rejects(
    assignSalesGeography({
      payload: { employeeId: zsm._id, geographyId: area._id, reason: "Invalid" },
      user: actor,
      dependencies: fixture.dependencies,
    }),
    /blocking conflicts/
  );
  assert.equal(fixture.assignments.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test("cross-company Geography and non-Sales employee fail safely", async () => {
  const otherCompanyGeography = doc({ ...zone, _id: oid(64), companyId: companyB });
  const financeUser = doc({ ...fsd, _id: oid(65), departmentId: financeDepartment._id, department: "Finance" });
  const fixture = createFixture();
  fixture.dependencies.Geography.records.push(otherCompanyGeography);
  fixture.dependencies.User.records.push(financeUser);

  const crossTenant = await previewSalesGeographyAssignment({ payload: { employeeId: fsd._id, geographyId: otherCompanyGeography._id, reason: "" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(crossTenant.canApply, false);
  assert.match(crossTenant.blockingConflicts.join(" "), /not found/i);
  const crossDepartment = await previewSalesGeographyAssignment({ payload: { employeeId: financeUser._id, geographyId: area._id, reason: "" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(crossDepartment.canApply, false);
  assert.match(crossDepartment.blockingConflicts.join(" "), /Sales Department/);
});

test("initial assignment is current, audited, and does not mutate reportingManagerId", async () => {
  const fixture = createFixture();
  const beforeManager = id(fixture.dependencies.User.records.find((item) => id(item._id) === id(zsm._id)).reportingManagerId);
  const assignment = await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial coverage" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(assignment.isCurrent, true);
  assert.equal(assignment.hierarchyLevel, 5);
  assert.equal(fixture.audits[0].action, "SALES_EMPLOYEE_GEOGRAPHY_ASSIGNED");
  assert.equal(id(fixture.dependencies.User.records.find((item) => id(item._id) === id(zsm._id)).reportingManagerId), beforeManager);
  assert.equal(fixture.session.committed, true);
});

test("top-down compatible and skip-level ancestor manager assignments succeed", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  const rsmAssignment = await assignSalesGeography({ payload: { employeeId: rsm._id, geographyId: region._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(rsmAssignment.isCurrent, true);

  const skipLevelFsd = fixture.dependencies.User.records.find((item) => id(item._id) === id(fsd._id));
  skipLevelFsd.reportingManagerId = zsm._id;
  const preview = await previewSalesGeographyAssignment({ payload: { employeeId: fsd._id, geographyId: area._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(preview.reportingCompatibility.status, "COMPATIBLE");
  assert.equal(preview.canApply, true);
});

test("unrelated or unassigned manager Geography does not block assignment", async () => {
  const fixture = createFixture();
  fixture.assignments.push(doc({
    _id: oid(66), companyId: companyA, employeeId: zsm._id, designationId: designations[1]._id,
    hierarchyLevel: 5, geographyId: otherZone._id, geographyType: "ZONE", assignmentType: "PRIMARY",
    isResponsibleManager: true, isCurrent: true, status: "current", deletedAt: null,
  }));
  const mismatch = await previewSalesGeographyAssignment({ payload: { employeeId: rsm._id, geographyId: region._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(mismatch.reportingCompatibility.status, "GEOGRAPHY_MISMATCH");
  assert.equal(mismatch.canApply, true);

  fixture.assignments.length = 0;
  const warning = await previewSalesGeographyAssignment({ payload: { employeeId: rsm._id, geographyId: region._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(warning.reportingCompatibility.status, "MANAGER_NOT_ASSIGNED");
  assert.equal(warning.canApply, true);
});

test("responsible Geography uniqueness requires explicit replacement and preserves displaced history", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: asm._id, geographyId: area._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  const replacementAsm = doc({ ...asm, _id: oid(67), fullName: "Replacement ASM", employeeId: "EMP-ASM-2" });
  fixture.dependencies.User.records.push(replacementAsm);
  const blocked = await previewSalesGeographyAssignment({ payload: { employeeId: replacementAsm._id, geographyId: area._id, reason: "Transfer" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(blocked.canApply, false);
  assert.ok(blocked.uniquenessConflict);

  const replacement = await assignSalesGeography({ payload: { employeeId: replacementAsm._id, geographyId: area._id, reason: "Transfer", replaceCurrentHolder: true }, user: actor, dependencies: fixture.dependencies });
  assert.equal(replacement.isCurrent, true);
  const currentManagers = fixture.assignments.filter((item) => item.isCurrent && item.isResponsibleManager && id(item.geographyId) === id(area._id));
  assert.equal(currentManagers.length, 1);
  assert.equal(fixture.assignments.some((item) => id(item.employeeId) === id(asm._id) && item.status === "ended"), true);
});

test("multiple FSDs may share one Area", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: fsd._id, geographyId: area._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  await assignSalesGeography({ payload: { employeeId: fsdTwo._id, geographyId: area._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(fixture.assignments.filter((item) => item.isCurrent && item.hierarchyLevel === 1 && id(item.geographyId) === id(area._id)).length, 2);
});

test("reassignment requires reason, closes old assignment, opens new assignment, and preserves history", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  const noReason = await previewSalesGeographyAssignment({ payload: { employeeId: zsm._id, geographyId: otherZone._id, reason: "" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(noReason.canApply, false);
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: otherZone._id, reason: "Territory change" }, user: actor, dependencies: fixture.dependencies });
  const history = await getAssignmentHistoryForEmployee({ employeeId: zsm._id, user: actor, dependencies: fixture.dependencies });
  assert.equal(history.length, 2);
  assert.equal(history.filter((item) => item.isCurrent).length, 1);
  assert.equal(history.some((item) => item.status === "ended" && item.endReason === "Territory change"), true);
  assert.equal(fixture.audits.some((entry) => entry.action === "SALES_EMPLOYEE_GEOGRAPHY_REASSIGNED"), true);
});

test("ending closes the current assignment without deleting history", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  const ended = await endCurrentSalesGeographyAssignment({ employeeId: zsm._id, reason: "Role vacant", user: actor, dependencies: fixture.dependencies });
  assert.equal(ended.status, "ended");
  assert.equal(ended.isCurrent, false);
  assert.equal(fixture.assignments.length, 1);
  assert.equal(fixture.assignments[0].deletedAt, null);
  assert.equal(fixture.audits.at(-1).action, "SALES_EMPLOYEE_GEOGRAPHY_ENDED");
});

test("inactive employee and inactive Geography cannot receive an assignment", async () => {
  const fixture = createFixture();
  fixture.dependencies.User.records.find((item) => id(item._id) === id(zsm._id)).status = "disabled";
  let preview = await previewSalesGeographyAssignment({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, false);
  fixture.dependencies.User.records.find((item) => id(item._id) === id(zsm._id)).status = "active";
  fixture.dependencies.Geography.records.find((item) => id(item._id) === id(zone._id)).status = "inactive";
  preview = await previewSalesGeographyAssignment({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, false);
});

test("idempotent repeated assignment leaves one current record and one success audit", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Repeat" }, user: actor, dependencies: fixture.dependencies });
  assert.equal(fixture.assignments.filter((item) => item.isCurrent && id(item.employeeId) === id(zsm._id)).length, 1);
  assert.equal(fixture.audits.length, 1);
});

test("simultaneous requests cannot leave two current primary assignments for one employee", async () => {
  const fixture = createFixture({ startSession: async () => fakeSession() });
  const results = await Promise.allSettled([
    assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Concurrent North" }, user: actor, dependencies: fixture.dependencies }),
    assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: otherZone._id, reason: "Concurrent South" }, user: actor, dependencies: fixture.dependencies }),
  ]);
  assert.equal(results.some((result) => result.status === "fulfilled"), true);
  assert.equal(fixture.assignments.filter((item) => item.isCurrent && id(item.employeeId) === id(zsm._id)).length, 1);
});

test("own read returns derived assignment but cannot read another employee", async () => {
  const fixture = createFixture();
  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  const ownUser = fixture.dependencies.User.records.find((item) => id(item._id) === id(zsm._id));
  const current = await getCurrentAssignmentForEmployee({ employeeId: ownUser._id, user: ownUser, ownOnly: true, dependencies: fixture.dependencies });
  assert.equal(id(current.employeeGeography.zone.id), id(zone._id));
  await assert.rejects(
    getCurrentAssignmentForEmployee({ employeeId: rsm._id, user: ownUser, ownOnly: true, dependencies: fixture.dependencies }),
    /Only your own/
  );
});

test("readiness treats manager Geography mismatch as ready when containment validation is disabled", async () => {
  const fixture = createFixture();
  const ambiguousUser = doc({
    ...branchManager,
    _id: oid(68),
    fullName: "Ambiguous Manager",
    employeeId: "EMP-AMB",
    designationId: ambiguousDesignation._id,
  });
  fixture.dependencies.User.records.push(ambiguousUser);
  fixture.assignments.push(
    doc({
      _id: oid(69), companyId: companyA, employeeId: zsm._id, designationId: designations[1]._id,
      hierarchyLevel: 5, geographyId: otherZone._id, geographyType: "ZONE", assignmentType: "PRIMARY",
      isResponsibleManager: true, isCurrent: true, status: "current", deletedAt: null,
    }),
    doc({
      _id: oid(70), companyId: companyA, employeeId: rsm._id, designationId: designations[2]._id,
      hierarchyLevel: 4, geographyId: region._id, geographyType: "REGION", assignmentType: "PRIMARY",
      isResponsibleManager: true, isCurrent: true, status: "current", deletedAt: null,
    })
  );

  const rows = await listSalesAssignmentReadiness({ user: actor, dependencies: fixture.dependencies });
  const byId = new Map(rows.map((row) => [id(row.id), row]));
  assert.equal(byId.get(id(head._id)).readiness, "NOT_APPLICABLE");
  assert.equal(byId.get(id(zsm._id)).readiness, "READY");
  assert.equal(byId.get(id(rsm._id)).readiness, "READY");
  assert.equal(byId.get(id(fsd._id)).readiness, "UNASSIGNED");
  assert.equal(byId.get(id(ambiguousUser._id)).readiness, "AMBIGUOUS_DESIGNATION");
});

test("responsibility tree shows one Area manager and multiple FSDs without mutating Geography", async () => {
  const fixture = createFixture();
  fixture.assignments.push(
    doc({ _id: oid(71), companyId: companyA, employeeId: asm._id, designationId: designations[4]._id, hierarchyLevel: 2, geographyId: area._id, geographyType: "AREA", assignmentType: "PRIMARY", isResponsibleManager: true, isCurrent: true, status: "current", deletedAt: null }),
    doc({ _id: oid(72), companyId: companyA, employeeId: fsd._id, designationId: designations[5]._id, hierarchyLevel: 1, geographyId: area._id, geographyType: "AREA", assignmentType: "PRIMARY", isResponsibleManager: false, isCurrent: true, status: "current", deletedAt: null }),
    doc({ _id: oid(73), companyId: companyA, employeeId: fsdTwo._id, designationId: designations[5]._id, hierarchyLevel: 1, geographyId: area._id, geographyType: "AREA", assignmentType: "PRIMARY", isResponsibleManager: false, isCurrent: true, status: "current", deletedAt: null })
  );
  const treeRows = await buildSalesAssignmentTree({ user: actor, dependencies: fixture.dependencies });
  const areaNode = treeRows[0].regions[0].branches[0].areas[0];
  assert.equal(areaNode.responsibleManager.employee.fullName, asm.fullName);
  assert.deepEqual(areaNode.fieldSalesExecutives.map((item) => item.employee.fullName).sort(), [fsd.fullName, fsdTwo.fullName].sort());
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.dependencies.Geography.records.find((item) => id(item._id) === id(area._id)), "asmId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fixture.dependencies.Geography.records.find((item) => id(item._id) === id(area._id)), "fsdIds"), false);
});

test("onboarding placement derives L1 through L5 as unassigned without creating assignments", async () => {
  const expectedTypes = { 5: "ZONE", 4: "REGION", 3: "BRANCH", 2: "AREA", 1: "AREA" };
  const fixture = createFixture();
  for (const employee of [zsm, rsm, branchManager, asm, fsd]) {
    const placement = await evaluateSalesPlacementForEmployee({
      employeeId: employee._id,
      companyId: companyA,
      dependencies: fixture.dependencies,
    });
    assert.equal(placement.applicable, true);
    assert.equal(placement.status, "UNASSIGNED");
    assert.equal(placement.geographyType, expectedTypes[placement.hierarchyLevel]);
  }
  assert.equal(fixture.assignments.length, 0);
});

test("onboarding placement treats L6 as complete scope and ambiguous Sales identity as an issue", async () => {
  const fixture = createFixture();
  const ambiguousUser = doc({
    ...branchManager,
    _id: oid(69),
    designationId: ambiguousDesignation._id,
  });
  fixture.dependencies.User.records.push(ambiguousUser);
  const headPlacement = await evaluateSalesPlacementForEmployee({
    employeeId: head._id,
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  const ambiguousPlacement = await evaluateSalesPlacementForEmployee({
    employeeId: ambiguousUser._id,
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  assert.equal(headPlacement.status, "NOT_APPLICABLE");
  assert.equal(headPlacement.currentGeography, null);
  assert.equal(ambiguousPlacement.status, "AMBIGUOUS_DESIGNATION");
  assert.match(ambiguousPlacement.assignmentIssue, /ambiguous/i);
});

test("non-Sales placement exits before assignment storage is queried", async () => {
  const fixture = createFixture();
  const financeUser = doc({
    ...fsd,
    _id: oid(70),
    departmentId: financeDepartment._id,
    department: "Finance",
  });
  fixture.dependencies.User.records.push(financeUser);
  fixture.dependencies.Assignment.findOne = () => {
    throw new Error("Assignment storage must not be queried");
  };
  const placement = await evaluateSalesPlacementForEmployee({
    employeeId: financeUser._id,
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  assert.equal(placement.applicable, false);
  assert.equal(placement.status, "NOT_APPLICABLE");
});

test("explicit Phase 3A assignment changes derived onboarding placement from unassigned to ready", async () => {
  const fixture = createFixture();
  const before = await evaluateSalesPlacementForEmployee({
    employeeId: zsm._id,
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  assert.equal(before.status, "UNASSIGNED");
  await assignSalesGeography({
    payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial placement" },
    user: actor,
    dependencies: fixture.dependencies,
  });
  const after = await evaluateSalesPlacementForEmployee({
    employeeId: zsm._id,
    companyId: companyA,
    dependencies: fixture.dependencies,
  });
  assert.equal(after.status, "READY");
  assert.equal(id(after.currentGeography.zone.id), id(zone._id));
});

test("compatible Geography lookup narrows to manager scope and warns without changing an unassigned manager", async () => {
  const fixture = createFixture();
  const otherRegion = doc({ ...region, _id: oid(71), name: "South Region", code: "SOUTH_REGION", parentId: otherZone._id });
  const otherBranch = doc({ ...branch, _id: oid(72), name: "South Branch", code: "SOUTH_BRANCH", parentId: otherRegion._id });
  fixture.dependencies.Geography.records.push(otherRegion, otherBranch);

  const beforeManager = id(fixture.dependencies.User.records.find((item) => id(item._id) === id(branchManager._id)).reportingManagerId);
  const unscoped = await listCompatibleGeographiesForEmployee({
    employeeId: branchManager._id,
    user: actor,
    dependencies: fixture.dependencies,
  });
  assert.equal(unscoped.options.length, 2);
  assert.match(unscoped.warning, /manager has no current Geography/i);

  await assignSalesGeography({ payload: { employeeId: zsm._id, geographyId: zone._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  await assignSalesGeography({ payload: { employeeId: rsm._id, geographyId: region._id, reason: "Initial" }, user: actor, dependencies: fixture.dependencies });
  const scoped = await listCompatibleGeographiesForEmployee({
    employeeId: branchManager._id,
    user: actor,
    dependencies: fixture.dependencies,
  });
  assert.deepEqual(scoped.options.map((item) => id(item.id)), [id(branch._id)]);
  assert.equal(scoped.managerScope.applied, true);
  assert.equal(id(fixture.dependencies.User.records.find((item) => id(item._id) === id(branchManager._id)).reportingManagerId), beforeManager);
  await assert.rejects(
    listCompatibleGeographiesForEmployee({
      employeeId: branchManager._id,
      user: { _id: oid(73), companyId: companyA, role: "hr_head" },
      dependencies: fixture.dependencies,
    }),
    /Only Head of Sales/
  );
});
