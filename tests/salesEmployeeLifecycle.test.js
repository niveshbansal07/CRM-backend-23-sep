const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LIFECYCLE_TYPES,
  getCompatibleReportingManagers,
  buildSalesTransferPreview,
  applySalesTransfer,
  buildEndAssignmentPreview,
  applyEndAssignment,
  buildOffboardingPreview,
  processSalesEmployeeOffboarding,
  getSalesLifecycleHistory,
} = require("../src/services/salesEmployeeLifecycle.service");

const oid = (suffix) => `75d65d0000000000000000${String(suffix).padStart(2, "0")}`;
const id = (value) => String(value?._id || value?.id || value || "");
const companyA = oid(1);
const companyB = oid(2);
const salesHeadActor = { _id: oid(3), companyId: companyA, role: "sales_head", fullName: "Sales Head Actor" };
const adminActor = { _id: oid(4), companyId: companyA, role: "company_admin", fullName: "Admin Actor" };

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
    const values = Array.isArray(payload) ? payload : [payload];
    const created = values.map((value, index) => {
      if (assignment && value.isCurrent) {
        const employeeConflict = records.find((record) => (
          record.isCurrent && !record.deletedAt && id(record.companyId) === id(value.companyId) &&
          id(record.employeeId) === id(value.employeeId)
        ));
        const holderConflict = value.isResponsibleManager && records.find((record) => (
          record.isCurrent && record.isResponsibleManager && !record.deletedAt &&
          id(record.companyId) === id(value.companyId) && id(record.geographyId) === id(value.geographyId)
        ));
        if (employeeConflict || holderConflict) {
          const error = new Error("duplicate"); error.code = 11000; throw error;
        }
      }
      const record = doc({
        _id: oid(80 + records.length + index),
        deletedAt: null,
        createdAt: new Date("2026-08-23T10:00:00.000Z"),
        updatedAt: new Date("2026-08-23T10:00:00.000Z"),
        ...value,
      });
      records.push(record);
      return record;
    });
    return Array.isArray(payload) ? created : created[0];
  },
});

const fakeSession = () => ({
  started: false, committed: false, aborted: false,
  startTransaction() { this.started = true; },
  async commitTransaction() { this.committed = true; },
  async abortTransaction() { this.aborted = true; },
  async endSession() {},
});

const salesDepartment = doc({ _id: oid(10), companyId: companyA, name: "Sales", code: "SALES", normalizedName: "sales", deletedAt: null });
const financeDepartment = doc({ _id: oid(11), companyId: companyA, name: "Finance", code: "FIN", normalizedName: "finance", deletedAt: null });
const definitions = [
  [6, "HEAD_OF_SALES", "Head of Sales", "sales_head"],
  [5, "ZONAL_SALES_MANAGER", "Zonal Sales Manager", "sales_manager"],
  [4, "REGIONAL_SALES_MANAGER", "Regional Sales Manager", "sales_manager"],
  [3, "BRANCH_MANAGER", "Branch Manager", "sales_manager"],
  [2, "AREA_SALES_MANAGER", "Area Sales Manager", "sales_manager"],
  [1, "FIELD_SALES_EXECUTIVE", "Field Sales Executive", "sales_executive"],
];
const designations = definitions.map(([hierarchyLevel, code, title, mappedRole], index) => doc({
  _id: oid(20 + index), companyId: companyA, departmentId: salesDepartment._id,
  hierarchyLevel, code, title, name: title, mappedRole, status: "active", deletedAt: null,
}));
const employeeForLevel = (level, suffix, overrides = {}) => {
  const designation = designations.find((item) => item.hierarchyLevel === level);
  return doc({
    _id: oid(suffix), companyId: companyA, fullName: `Employee L${level}`,
    employeeId: `EMP-${suffix}`, role: designation.mappedRole, systemRole: designation.mappedRole,
    departmentId: salesDepartment._id, department: "Sales", designationId: designation._id,
    designation: designation.title, reportingManagerId: null, managerId: null,
    status: "active", deletedAt: null, statusHistory: [],
    ...overrides,
  });
};

const head = employeeForLevel(6, 30);
const zsm = employeeForLevel(5, 31, { reportingManagerId: head._id, managerId: head._id });
const rsm = employeeForLevel(4, 32, { reportingManagerId: zsm._id, managerId: zsm._id });
const branchManager = employeeForLevel(3, 33, { reportingManagerId: rsm._id, managerId: rsm._id });
const asmA = employeeForLevel(2, 34, { fullName: "ASM A", reportingManagerId: branchManager._id, managerId: branchManager._id });
const asmB = employeeForLevel(2, 35, { fullName: "ASM B", reportingManagerId: branchManager._id, managerId: branchManager._id });
const fsd = employeeForLevel(1, 36, { fullName: "FSD", reportingManagerId: branchManager._id, managerId: branchManager._id });

const zone = doc({ _id: oid(40), companyId: companyA, type: "ZONE", name: "North", code: "NORTH", parentId: null, status: "active", isActive: true, isArchived: false, deletedAt: null });
const region = doc({ _id: oid(41), companyId: companyA, type: "REGION", name: "West", code: "WEST", parentId: zone._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const branch = doc({ _id: oid(42), companyId: companyA, type: "BRANCH", name: "Main", code: "MAIN", parentId: region._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const areaA = doc({ _id: oid(43), companyId: companyA, type: "AREA", name: "Area A", code: "AREA_A", parentId: branch._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const areaB = doc({ _id: oid(44), companyId: companyA, type: "AREA", name: "Area B", code: "AREA_B", parentId: branch._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const otherZone = doc({ _id: oid(45), companyId: companyA, type: "ZONE", name: "South", code: "SOUTH", parentId: null, status: "active", isActive: true, isArchived: false, deletedAt: null });
const otherRegion = doc({ _id: oid(46), companyId: companyA, type: "REGION", name: "South Region", code: "SOUTH_R", parentId: otherZone._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const otherBranch = doc({ _id: oid(47), companyId: companyA, type: "BRANCH", name: "South Branch", code: "SOUTH_B", parentId: otherRegion._id, status: "active", isActive: true, isArchived: false, deletedAt: null });
const areaC = doc({ _id: oid(48), companyId: companyA, type: "AREA", name: "Area C", code: "AREA_C", parentId: otherBranch._id, status: "active", isActive: true, isArchived: false, deletedAt: null });

const currentAssignment = (employee, geography, level) => doc({
  _id: oid(60 + level + Number(String(employee._id).slice(-1))), companyId: companyA,
  employeeId: employee._id, designationId: employee.designationId, hierarchyLevel: level,
  geographyId: geography._id, geographyType: geography.type, assignmentType: "PRIMARY",
  isResponsibleManager: level > 1, effectiveFrom: new Date("2026-08-20T10:00:00.000Z"),
  effectiveTo: null, status: "current", isCurrent: true, assignedBy: salesHeadActor._id,
  assignmentReason: "Initial", deletedAt: null,
});

const createFixture = ({ fsdManager = branchManager._id } = {}) => {
  const users = [head, zsm, rsm, branchManager, asmA, asmB, fsd].map((item) => doc({ ...item, statusHistory: [...(item.statusHistory || [])] }));
  const fixtureFsd = users.find((item) => id(item._id) === id(fsd._id));
  fixtureFsd.reportingManagerId = fsdManager;
  fixtureFsd.managerId = fsdManager;
  const byId = new Map(users.map((item) => [id(item._id), item]));
  const assignments = [
    currentAssignment(byId.get(id(zsm._id)), zone, 5),
    currentAssignment(byId.get(id(rsm._id)), region, 4),
    currentAssignment(byId.get(id(branchManager._id)), branch, 3),
    currentAssignment(byId.get(id(asmA._id)), areaA, 2),
    currentAssignment(byId.get(id(asmB._id)), areaB, 2),
    currentAssignment(fixtureFsd, areaA, 1),
  ];
  const events = [];
  const audits = [];
  const session = fakeSession();
  const UserModel = createModel(users);
  const dependencies = {
    User: UserModel,
    Department: createModel([salesDepartment, financeDepartment].map((item) => doc({ ...item }))),
    Designation: createModel(designations.map((item) => doc({ ...item }))),
    Geography: createModel([zone, region, branch, areaA, areaB, otherZone, otherRegion, otherBranch, areaC].map((item) => doc({ ...item }))),
    Assignment: createModel(assignments, { assignment: true }),
    LifecycleEvent: createModel(events),
    validateReportingManagerAssignment: async ({ employeeId, reportingManagerId }) => {
      const employee = byId.get(id(employeeId));
      const manager = byId.get(id(reportingManagerId));
      if (!manager || manager.status !== "active" || id(manager.companyId) !== id(employee.companyId)) throw Object.assign(new Error("Active reporting manager not found"), { statusCode: 404 });
      if (id(manager.departmentId) !== id(employee.departmentId)) throw Object.assign(new Error("Cross-department reporting manager assignment requires override permission"), { statusCode: 400 });
      const employeeDesignation = designations.find((item) => id(item._id) === id(employee.designationId));
      const managerDesignation = designations.find((item) => id(item._id) === id(manager.designationId));
      if (managerDesignation.hierarchyLevel <= employeeDesignation.hierarchyLevel) throw Object.assign(new Error("Reporting manager must have a higher hierarchy level"), { statusCode: 400 });
      return { reportingManagerId: manager._id, manager, employeeDesignation, managerDesignation };
    },
    getAllowedManagersForEmployee: async ({ excludeUserId }) => users
      .filter((item) => id(item._id) !== id(excludeUserId) && item.status === "active")
      .map((item) => ({ id: item._id, _id: item._id, fullName: item.fullName, designation: item.designation })),
    writeAuditLog: async (entry) => { audits.push(entry); return entry; },
    invalidateOrgTreeCache: () => {},
    startSession: async () => session,
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    newOperationId: () => oid(90 + events.length),
  };
  return { dependencies, users, assignments, events, audits, session, byId };
};

test("Geography-only FSD transfer keeps a compatible current manager and preserves assignment history", async () => {
  const fixture = createFixture();
  const preview = await buildSalesTransferPreview({
    payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Territory balance" },
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(preview.canApply, true);
  assert.equal(preview.type, LIFECYCLE_TYPES.GEOGRAPHY_TRANSFER);
  assert.equal(preview.managerDecision, "CURRENT_MANAGER_COMPATIBLE");
  const result = await applySalesTransfer({
    payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Territory balance" },
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(result.applied, true);
  assert.equal(id(fixture.byId.get(id(fsd._id)).reportingManagerId), id(branchManager._id));
  assert.equal(fixture.assignments.filter((item) => id(item.employeeId) === id(fsd._id) && item.isCurrent).length, 1);
  assert.equal(fixture.assignments.find((item) => id(item.employeeId) === id(fsd._id) && !item.isCurrent).status, "ended");
  assert.equal(fixture.events[0].type, "GEOGRAPHY_TRANSFER");
  assert.equal(fixture.session.committed, true);
});

test("repeating an already-applied transfer is idempotent and creates no nonsense history", async () => {
  const fixture = createFixture();
  const payload = { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Territory balance" };
  await applySalesTransfer({ payload, user: salesHeadActor, dependencies: fixture.dependencies });
  const eventCount = fixture.events.length;
  const second = await applySalesTransfer({ payload, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(second.applied, false);
  assert.equal(second.preview.type, "NO_CHANGE");
  assert.equal(fixture.events.length, eventCount);
});

test("combined FSD Geography and manager transfer applies both changes in one transaction", async () => {
  const fixture = createFixture({ fsdManager: asmA._id });
  const payload = {
    employeeId: fsd._id,
    targetGeographyId: areaB._id,
    proposedReportingManagerId: asmB._id,
    reason: "Territory restructuring",
  };
  const preview = await buildSalesTransferPreview({ payload, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, true);
  assert.equal(preview.type, "GEOGRAPHY_AND_MANAGER_TRANSFER");
  assert.equal(preview.managerDecision, "CURRENT_MANAGER_COMPATIBLE");
  const result = await applySalesTransfer({ payload, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(result.applied, true);
  assert.equal(id(fixture.byId.get(id(fsd._id)).reportingManagerId), id(asmB._id));
  assert.equal(fixture.events[0].oldReportingManagerId, asmA._id);
  assert.equal(fixture.events[0].newReportingManagerId, asmB._id);
  assert.equal(fixture.audits[0].metadata.operationId, fixture.events[0].operationId);
});

test("combined transfer aborts its transaction if reporting-manager persistence fails", async () => {
  const fixture = createFixture({ fsdManager: asmA._id });
  fixture.byId.get(id(fsd._id)).save = async () => { throw new Error("manager save failed"); };
  await assert.rejects(
    applySalesTransfer({
      payload: {
        employeeId: fsd._id,
        targetGeographyId: areaB._id,
        proposedReportingManagerId: asmB._id,
        reason: "Territory restructuring",
      },
      user: salesHeadActor,
      dependencies: fixture.dependencies,
    }),
    /manager save failed/
  );
  assert.equal(fixture.session.aborted, true);
  assert.equal(fixture.session.committed, false);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.audits.length, 0);
});

test("reporting-manager-only change reuses validation and creates Sales-scoped manager history", async () => {
  const fixture = createFixture();
  const payload = {
    employeeId: fsd._id,
    proposedReportingManagerId: asmA._id,
    reason: "Align reporting line",
  };
  const preview = await buildSalesTransferPreview({ payload, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(preview.canApply, true);
  assert.equal(preview.type, "REPORTING_MANAGER_CHANGE");
  assert.equal(preview.geographyChanged, false);
  const result = await applySalesTransfer({ payload, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(result.event.type, "REPORTING_MANAGER_CHANGE");
  assert.equal(id(fixture.byId.get(id(fsd._id)).reportingManagerId), id(asmA._id));
  assert.equal(fixture.assignments.filter((item) => id(item.employeeId) === id(fsd._id)).length, 1);
  assert.equal(fixture.audits[0].action, "SALES_REPORTING_MANAGER_CHANGED");
});

test("manager Geography mismatch does not block a Geography transfer", async () => {
  const fixture = createFixture({ fsdManager: asmA._id });
  const missingManager = await buildSalesTransferPreview({
    payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Move" },
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(missingManager.canApply, true);
  assert.equal(missingManager.currentManagerCompatibility.status, "GEOGRAPHY_MISMATCH");

  const invalidManager = await buildSalesTransferPreview({
    payload: { employeeId: fsd._id, targetGeographyId: areaB._id, proposedReportingManagerId: asmA._id, reason: "Move" },
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(invalidManager.canApply, true);
  assert.equal(invalidManager.proposedManagerCompatibility.status, "GEOGRAPHY_MISMATCH");
});

test("manager transfer preview detects active direct reports that would become incompatible and apply stays zero-write", async () => {
  const fixture = createFixture({ fsdManager: asmA._id });
  const beforeAssignments = fixture.assignments.length;
  const preview = await buildSalesTransferPreview({
    payload: { employeeId: asmA._id, targetGeographyId: areaC._id, proposedReportingManagerId: branchManager._id, reason: "Manager move", replaceCurrentHolder: true },
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(preview.canApply, false);
  assert.equal(preview.directReportImpact.length, 1);
  assert.equal(preview.directReportImpact[0].compatibility, "GEOGRAPHY_MISMATCH");
  assert.equal(fixture.assignments.length, beforeAssignments);
  await assert.rejects(
    applySalesTransfer({
      payload: { employeeId: asmA._id, targetGeographyId: areaC._id, proposedReportingManagerId: branchManager._id, reason: "Manager move", replaceCurrentHolder: true },
      user: salesHeadActor,
      dependencies: fixture.dependencies,
    }),
    /blocking conflicts/
  );
});

test("responsible-manager transfer requires explicit replacement and leaves the displaced holder unassigned", async () => {
  const fixture = createFixture();
  const basePayload = {
    employeeId: asmA._id,
    targetGeographyId: areaB._id,
    reason: "Coverage change",
  };
  const blocked = await buildSalesTransferPreview({ payload: basePayload, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(blocked.canApply, false);
  assert.ok(blocked.destinationConflict);
  const result = await applySalesTransfer({
    payload: { ...basePayload, replaceCurrentHolder: true },
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(result.applied, true);
  assert.equal(fixture.assignments.some((item) => id(item.employeeId) === id(asmB._id) && item.isCurrent), false);
  assert.equal(fixture.assignments.some((item) => id(item.employeeId) === id(asmA._id) && item.isCurrent && id(item.geographyId) === id(areaB._id)), true);
  assert.equal(fixture.events[0].displacedEmployeeId, asmB._id);
  assert.equal(fixture.audits.some((entry) => entry.action === "SALES_RESPONSIBLE_MANAGER_REPLACED"), true);
});

test("wrong Geography type and reporting cycle validation remain blocking while an unassigned employee can be placed", async () => {
  const wrongTypeFixture = createFixture();
  const wrongType = await buildSalesTransferPreview({
    payload: { employeeId: fsd._id, targetGeographyId: branch._id, reason: "Wrong type" },
    user: salesHeadActor,
    dependencies: wrongTypeFixture.dependencies,
  });
  assert.equal(wrongType.canApply, false);
  assert.match(wrongType.blockingConflicts.join(" "), /require AREA/i);

  const cycleFixture = createFixture();
  cycleFixture.dependencies.validateReportingManagerAssignment = async () => {
    throw Object.assign(new Error("Circular reporting hierarchy is not allowed"), { statusCode: 400 });
  };
  const cycle = await buildSalesTransferPreview({
    payload: { employeeId: fsd._id, proposedReportingManagerId: asmA._id, reason: "Cycle" },
    user: salesHeadActor,
    dependencies: cycleFixture.dependencies,
  });
  assert.equal(cycle.canApply, false);
  assert.match(cycle.blockingConflicts.join(" "), /Circular reporting hierarchy/);

  const unassignedFixture = createFixture();
  unassignedFixture.assignments.splice(
    unassignedFixture.assignments.findIndex((item) => id(item.employeeId) === id(fsd._id)),
    1
  );
  const initial = await buildSalesTransferPreview({
    payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Initial placement" },
    user: salesHeadActor,
    dependencies: unassignedFixture.dependencies,
  });
  assert.equal(initial.canApply, true);
  const applied = await applySalesTransfer({
    payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Initial placement" },
    user: salesHeadActor,
    dependencies: unassignedFixture.dependencies,
  });
  assert.equal(applied.assignment.isCurrent, true);
});

test("compatible manager candidates prefer the nearest level and exclude unrelated Geography", async () => {
  const fixture = createFixture({ fsdManager: asmA._id });
  const result = await getCompatibleReportingManagers({
    employeeId: fsd._id,
    geographyId: areaB._id,
    user: salesHeadActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(id(result.candidates[0].id), id(asmB._id));
  assert.equal(result.candidates.some((item) => id(item.id) === id(asmA._id)), false);
  assert.equal(result.candidates.at(-1).hierarchyLevel, 6);
});

test("assignment ending creates a real vacancy and a linked lifecycle history event", async () => {
  const fixture = createFixture();
  const preview = await buildEndAssignmentPreview({ employeeId: zsm._id, reason: "Position vacant", user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(preview.vacancy.created, true);
  const result = await applyEndAssignment({ employeeId: zsm._id, reason: "Position vacant", user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(result.event.type, "END_ASSIGNMENT");
  assert.equal(fixture.assignments.find((item) => id(item.employeeId) === id(zsm._id)).isCurrent, false);
  const history = await getSalesLifecycleHistory({ employeeId: zsm._id, user: salesHeadActor, dependencies: fixture.dependencies });
  assert.equal(history[0].type, "END_ASSIGNMENT");
});

test("L1 permanent offboarding closes assignment while suspension preserves it and touches no CRM ownership model", async () => {
  const suspendedFixture = createFixture();
  const temporary = await processSalesEmployeeOffboarding({
    employee: suspendedFixture.byId.get(id(fsd._id)),
    previousStatus: "active",
    targetStatus: "suspended",
    reason: "Temporary suspension",
    user: adminActor,
    dependencies: suspendedFixture.dependencies,
  });
  assert.equal(temporary.handled, false);
  assert.equal(suspendedFixture.assignments.find((item) => id(item.employeeId) === id(fsd._id)).isCurrent, true);

  const fixture = createFixture();
  const result = await processSalesEmployeeOffboarding({
    employee: fixture.byId.get(id(fsd._id)),
    previousStatus: "active",
    targetStatus: "disabled",
    reason: "Employment ended",
    user: adminActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(result.handled, true);
  assert.equal(fixture.byId.get(id(fsd._id)).status, "disabled");
  assert.equal(fixture.assignments.find((item) => id(item.employeeId) === id(fsd._id)).isCurrent, false);
  assert.equal(fixture.events[0].type, "EMPLOYEE_OFFBOARDING");
  assert.deepEqual(Object.keys(fixture.dependencies).filter((key) => /Account|Lead|Visit|Order|Distributor/.test(key)), []);
});

test("manager offboarding with active direct reports and ordinary L6 offboarding are blocked", async () => {
  const fixture = createFixture({ fsdManager: asmA._id });
  const preview = await buildOffboardingPreview({
    employeeId: asmA._id,
    targetStatus: "disabled",
    reason: "Employment ended",
    user: adminActor,
    dependencies: fixture.dependencies,
  });
  assert.equal(preview.canApply, false);
  assert.equal(preview.blockingConflicts[0], "OFFBOARDING_BLOCKED_REQUIRES_REPORTING_RESOLUTION");
  await assert.rejects(
    processSalesEmployeeOffboarding({
      employee: fixture.byId.get(id(asmA._id)), previousStatus: "active", targetStatus: "disabled",
      reason: "Employment ended", user: adminActor, dependencies: fixture.dependencies,
    }),
    /direct-report resolution/
  );
  await assert.rejects(
    buildOffboardingPreview({ employeeId: head._id, targetStatus: "disabled", reason: "No", user: adminActor, dependencies: fixture.dependencies }),
    /HOD lifecycle governance/
  );
});

test("Sales lifecycle mutation authority remains Head/Admin-only and company-scoped", async () => {
  const fixture = createFixture();
  for (const role of ["sales_manager", "sales_executive", "hr_head", "employee"]) {
    await assert.rejects(
      buildSalesTransferPreview({
        payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Move" },
        user: { _id: oid(95), companyId: companyA, role },
        dependencies: fixture.dependencies,
      }),
      /Only Head of Sales/
    );
  }
  await assert.rejects(
    buildSalesTransferPreview({
      payload: { employeeId: fsd._id, targetGeographyId: areaB._id, reason: "Move" },
      user: { ...salesHeadActor, companyId: companyB },
      dependencies: fixture.dependencies,
    }),
    /not found/
  );
});
