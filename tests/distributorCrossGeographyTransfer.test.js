const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  buildReassignmentPreview,
  createReassignmentRequest,
  approveReassignmentRequest,
  rejectReassignmentRequest,
  getReassignmentHistory,
  listReassignmentRequests,
  listApprovalQueue,
} = require("../src/services/distributorReassignment.service");

const oid = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const id = (value) => String(value?._id || value?.id || value || "");
const companyId = oid(1);
const makeGeo = (n, name, type) => ({ _id: oid(n), companyId, name, code: `${type}-${n}`, type, status: "active", deletedAt: null });
const zoneA = makeGeo(10, "North", "ZONE");
const zoneB = makeGeo(11, "South", "ZONE");
const regionA = makeGeo(12, "Western", "REGION");
const regionB = makeGeo(13, "Eastern", "REGION");
const regionC = makeGeo(14, "Southern", "REGION");
const branchA = makeGeo(15, "Muzaffarnagar", "BRANCH");
const branchB = makeGeo(16, "Meerut", "BRANCH");
const branchC = makeGeo(17, "Lucknow", "BRANCH");
const branchD = makeGeo(18, "Chennai", "BRANCH");
const areaA = makeGeo(20, "Budhana", "AREA");
const areaB = makeGeo(21, "Khatauli", "AREA");
const areaC = makeGeo(22, "Meerut City", "AREA");
const areaD = makeGeo(23, "Lucknow City", "AREA");
const areaE = makeGeo(24, "Chennai City", "AREA");
const geographies = [zoneA, zoneB, regionA, regionB, regionC, branchA, branchB, branchC, branchD, areaA, areaB, areaC, areaD, areaE];
const paths = new Map([
  [id(areaA._id), { zone: zoneA, region: regionA, branch: branchA, area: areaA }],
  [id(areaB._id), { zone: zoneA, region: regionA, branch: branchA, area: areaB }],
  [id(areaC._id), { zone: zoneA, region: regionA, branch: branchB, area: areaC }],
  [id(areaD._id), { zone: zoneA, region: regionB, branch: branchC, area: areaD }],
  [id(areaE._id), { zone: zoneB, region: regionC, branch: branchD, area: areaE }],
]);

const employee = (n, fullName, level, geography = null, role = level === 6 ? "sales_head" : level === 1 ? "sales_executive" : "sales_manager") => ({
  _id: oid(n), companyId, fullName, employeeId: `E-${n}`, role, systemRole: role, level, status: "active", deletedAt: null,
  reportingManagerId: level === 1 ? oid(30) : null, geography,
});
const asm = employee(30, "Area ASM", 2, areaA);
const branchManager = employee(31, "Shared Branch Manager", 3, branchA);
const otherBranchManager = employee(32, "Other Branch Manager", 3, branchB);
const rsm = employee(33, "Shared RSM", 4, regionA);
const otherRsm = employee(34, "Other RSM", 4, regionB);
const zsm = employee(35, "Shared ZSM", 5, zoneA);
const otherZsm = employee(36, "Other ZSM", 5, zoneB);
const head = employee(37, "Head of Sales", 6);
const admin = { ...employee(38, "Company Admin", 0, null, "company_admin"), role: "company_admin", systemRole: "company_admin" };
const oldFsd = employee(40, "Old FSD", 1, areaA);
const fsdB = employee(41, "Khatauli FSD", 1, areaB);
const fsdC = employee(42, "Meerut FSD", 1, areaC);
const fsdD = employee(43, "Lucknow FSD", 1, areaD);
const fsdE = employee(44, "Chennai FSD", 1, areaE);

const fakeSession = () => ({
  startTransaction() { this.started = true; },
  async commitTransaction() { this.committed = true; },
  async abortTransaction() { this.aborted = true; },
  async endSession() {},
});
const matches = (record, query) => Object.entries(query || {}).every(([key, expected]) => {
  if (key === "$or") return expected.some((part) => matches(record, part));
  if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.some((item) => id(item) === id(record[key]));
  return id(record[key]) === id(expected);
});
const model = (rows) => ({
  find: (query) => Promise.resolve(rows.filter((row) => matches(row, query))),
  findOne: (query) => Promise.resolve(rows.find((row) => matches(row, query)) || null),
});
const requestDoc = (value, requests) => ({
  _id: value._id || oid(80 + requests.length), createdAt: new Date("2026-08-23T10:00:00.000Z"), deletedAt: null, ...value,
  async save() { this.isOpen = ["PENDING", "APPROVED"].includes(this.status); return this; },
});

const makeFixture = ({ vacantLevel = null } = {}) => {
  const account = {
    _id: oid(50), companyId, name: "ABC Distributor", status: "active", assignedTo: oldFsd._id,
    reportingManagerId: asm._id, territory: "Legacy territory", deletedAt: null,
    accountTypeId: { _id: oid(51), code: "DISTRIBUTOR", name: "Distributor" },
    async save() { this.saveCount = (this.saveCount || 0) + 1; return this; }, toObject() { return { ...this }; },
  };
  const current = {
    _id: oid(52), companyId, distributorAccountId: account._id, geographyId: areaA._id, geographyType: "AREA",
    primaryFsdId: oldFsd._id, effectiveFrom: new Date("2026-08-01T00:00:00Z"), effectiveTo: null,
    isCurrent: true, status: "current", operationId: oid(53), assignmentReason: "Initial", deletedAt: null,
  };
  const mappings = [current];
  const requests = [];
  const audits = [];
  const users = [asm, branchManager, otherBranchManager, rsm, otherRsm, zsm, otherZsm, head, admin, oldFsd, fsdB, fsdC, fsdD, fsdE];
  const assignments = [
    { _id: oid(60), companyId, employeeId: asm._id, geographyId: areaA._id, geographyType: "AREA", hierarchyLevel: 2, isCurrent: true, isResponsibleManager: true, deletedAt: null },
    ...(vacantLevel === 3 ? [] : [{ _id: oid(61), companyId, employeeId: branchManager._id, geographyId: branchA._id, geographyType: "BRANCH", hierarchyLevel: 3, isCurrent: true, isResponsibleManager: true, deletedAt: null }]),
    ...(vacantLevel === 4 ? [] : [{ _id: oid(62), companyId, employeeId: rsm._id, geographyId: regionA._id, geographyType: "REGION", hierarchyLevel: 4, isCurrent: true, isResponsibleManager: true, deletedAt: null }]),
    ...(vacantLevel === 5 ? [] : [{ _id: oid(63), companyId, employeeId: zsm._id, geographyId: zoneA._id, geographyType: "ZONE", hierarchyLevel: 5, isCurrent: true, isResponsibleManager: true, deletedAt: null }]),
    ...[oldFsd, fsdB, fsdC, fsdD, fsdE].map((item, index) => ({ _id: oid(65 + index), companyId, employeeId: item._id, geographyId: item.geography._id, geographyType: "AREA", hierarchyLevel: 1, isCurrent: true, isResponsibleManager: false, deletedAt: null })),
  ];
  const session = fakeSession();
  const dependencies = {
    Account: model([account]), User: model(users), Geography: model(geographies), EmployeeAssignment: model(assignments),
    DistributorMapping: {
      ...model(mappings),
      async updateOne(query, update) { const row = mappings.find((item) => matches(item, query)); if (!row) return { modifiedCount: 0 }; Object.assign(row, update.$set); return { modifiedCount: 1 }; },
      async create(values) { const docs = values.map((value, index) => ({ _id: oid(90 + mappings.length + index), deletedAt: null, ...value })); mappings.push(...docs); return docs; },
    },
    ReassignmentRequest: {
      ...model(requests),
      async create(values) { const docs = values.map((value) => requestDoc(value, requests)); requests.push(...docs); return docs; },
    },
    loadDistributorAccount: async ({ accountId: requested, companyId: tenant }) => {
      if (id(requested) !== id(account._id) || id(tenant) !== id(companyId)) throw Object.assign(new Error("not found"), { statusCode: 404 });
      return account;
    },
    validateArea: async ({ areaId, companyId: tenant }) => {
      const target = geographies.find((item) => id(item._id) === id(areaId) && id(item.companyId) === id(tenant));
      if (!target || target.type !== "AREA" || target.status !== "active" || target.deletedAt) throw Object.assign(new Error("Active Area path not found"), { statusCode: 404 });
      return { target, path: paths.get(id(target._id)) };
    },
    findEmployeeContext: async ({ employeeId, companyId: tenant }) => {
      const item = users.find((user) => id(user._id) === id(employeeId) && id(user.companyId) === id(tenant));
      if (!item) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
      return { employee: item, identity: { valid: item.level >= 1, hierarchyLevel: item.level, technicalRole: item.role, designation: { title: item.fullName } }, department: { name: "Sales" } };
    },
    findCurrentAssignment: async ({ employeeId }) => assignments.find((item) => id(item.employeeId) === id(employeeId) && item.isCurrent && !item.deletedAt) || null,
    validatePrimaryFsd: async ({ fsdId, areaId, companyId: tenant }) => {
      const item = users.find((user) => id(user._id) === id(fsdId) && id(user.companyId) === id(tenant));
      if (!item) throw Object.assign(new Error("Primary FSD not found"), { statusCode: 404 });
      if (item.level !== 1 || item.role !== "sales_executive") throw Object.assign(new Error("Primary FSD must be structured L1"), { statusCode: 400 });
      if (item.status !== "active" || item.deletedAt) throw Object.assign(new Error("Primary FSD must be active"), { statusCode: 409 });
      const assignment = assignments.find((row) => id(row.employeeId) === id(fsdId) && row.isCurrent);
      if (!assignment || id(assignment.geographyId) !== id(areaId)) throw Object.assign(new Error("Primary FSD Geography must match destination Area"), { statusCode: 409 });
      return { context: { employee: item, identity: { valid: true, hierarchyLevel: 1, technicalRole: "sales_executive", designation: { title: "FSD" } }, department: { name: "Sales" } }, assignment };
    },
    buildSupervisoryOwnership: async ({ path, primaryFsdContext }) => ({
      chain: { asm: { id: asm._id, fullName: asm.fullName }, branchManager: { id: branchManager._id, fullName: branchManager.fullName }, rsm: { id: rsm._id, fullName: rsm.fullName }, zsm: { id: zsm._id, fullName: zsm.fullName }, headOfSales: { id: head._id, fullName: head.fullName } },
      warnings: [], path, primaryFsdContext,
    }),
    evaluateCurrentMapping: async () => ({ state: "MAPPED_VALID", requiresReassignment: false, warnings: [] }),
    listDistributorMappingReadiness: async () => ({ summary: {}, distributors: [] }),
    writeAuditLog: async (entry) => { audits.push(entry); return entry; }, startSession: async () => session,
    now: () => new Date("2026-08-23T12:00:00.000Z"), newOperationId: () => oid(95),
  };
  return { account, current, mappings, requests, audits, assignments, users, dependencies, session };
};

const transfer = (area, fsd) => ({ distributorAccountId: oid(50), destinationAreaId: area._id, newPrimaryFsdId: fsd._id, reason: "Approved market boundary transfer" });

test("server classifies every cross-Geography boundary and derives L3-L6 authority", async () => {
  const cases = [
    [areaB, fsdB, "CROSS_AREA_SAME_BRANCH", "BRANCH_MANAGER", 3],
    [areaC, fsdC, "CROSS_BRANCH_SAME_REGION", "RSM", 4],
    [areaD, fsdD, "CROSS_REGION_SAME_ZONE", "ZSM", 5],
    [areaE, fsdE, "CROSS_ZONE", "HEAD_OF_SALES", 6],
  ];
  for (const [destination, fsd, boundary, approval, level] of cases) {
    const f = makeFixture();
    const preview = await buildReassignmentPreview({ payload: transfer(destination, fsd), user: head, dependencies: f.dependencies });
    assert.equal(preview.boundaryType, boundary);
    assert.equal(preview.approval.requiredLevel, approval);
    assert.equal(preview.approval.hierarchyLevel, level);
    assert.equal(f.requests.length, 0);
    assert.equal(f.account.saveCount, undefined);
  }
});

test("impact preview reports old/new paths, supervisor chains, changed levels, and mirror health", async () => {
  const f = makeFixture();
  const preview = await buildReassignmentPreview({ payload: transfer(areaC, fsdC), user: head, dependencies: f.dependencies });
  assert.equal(preview.current.geography.area.name, "Budhana");
  assert.equal(preview.destination.geography.area.name, "Meerut City");
  assert.equal(preview.current.primaryFsd.fullName, "Old FSD");
  assert.equal(preview.destination.primaryFsd.fullName, "Meerut FSD");
  assert.ok(preview.impact.changed.includes("BRANCH_MANAGER"));
  assert.ok(preview.impact.unchanged.includes("RSM"));
  assert.equal(preview.accountMirror.consistent, true);
});

test("cross-Area request is Branch Manager approved and atomically changes Area plus FSD", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  assert.equal(f.requests[0].status, "PENDING");
  assert.equal(f.requests[0].requiredApprovalLevel, "BRANCH_MANAGER");
  assert.equal(f.current.isCurrent, true);
  const result = await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Branch coverage confirmed" }, user: branchManager, dependencies: f.dependencies });
  assert.equal(result.applied, true);
  assert.equal(f.current.isCurrent, false);
  assert.equal(f.mappings[1].geographyId, areaB._id);
  assert.equal(f.mappings[1].primaryFsdId, fsdB._id);
  assert.equal(f.account.assignedTo, fsdB._id);
  assert.equal(f.account.reportingManagerId, fsdB.reportingManagerId);
  assert.equal(f.account.territory, "Legacy territory");
  assert.equal(f.requests[0].status, "APPLIED");
  assert.equal(f.current.effectiveTo.getTime(), f.mappings[1].effectiveFrom.getTime());
});

test("cross-Branch requires current L4 RSM, not an L3 manager sharing sales_manager role", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaC, fsdC), user: head, dependencies: f.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Wrong level" }, user: branchManager, dependencies: f.dependencies }), /current responsible RSM/);
  assert.equal((await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Region coverage confirmed" }, user: rsm, dependencies: f.dependencies })).applied, true);
});

test("cross-Region requires current L5 ZSM and rejects same-role L4 RSM", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaD, fsdD), user: head, dependencies: f.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Wrong level" }, user: rsm, dependencies: f.dependencies }), /current responsible ZSM/);
  assert.equal((await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Zone coverage confirmed" }, user: zsm, dependencies: f.dependencies })).applied, true);
});

test("cross-Zone requires Head of Sales and controlled self-approval", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaE, fsdE), user: admin, dependencies: f.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Wrong level" }, user: zsm, dependencies: f.dependencies }), /current responsible HEAD_OF_SALES/);
  assert.equal((await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "National coverage approved" }, user: head, dependencies: f.dependencies })).applied, true);
  const self = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaE, fsdE), user: head, dependencies: self.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: self.requests[0]._id, payload: { decisionReason: "Self approval" }, user: head, dependencies: self.dependencies }), /override reason/);
});

test("wrong Geography manager at the correct level cannot approve", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Other branch" }, user: otherBranchManager, dependencies: f.dependencies }), /current responsible BRANCH_MANAGER/);
});

test("vacant boundary manager falls back to Head with explicit override reason", async () => {
  const f = makeFixture({ vacantLevel: 3 });
  const created = await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: admin, dependencies: f.dependencies });
  assert.equal(created.request.approvalLevel, "HEAD_OF_SALES");
  assert.ok(created.warnings.includes("REQUIRED_APPROVER_VACANT_HEAD_APPROVAL_REQUIRED"));
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Fallback" }, user: head, dependencies: f.dependencies }), /override reason/);
  assert.equal((await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Fallback", overrideReason: "Branch manager seat vacant" }, user: head, dependencies: f.dependencies })).applied, true);

  const becameVacant = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: admin, dependencies: becameVacant.dependencies });
  becameVacant.assignments.splice(becameVacant.assignments.findIndex((item) => item.hierarchyLevel === 3), 1);
  await assert.rejects(approveReassignmentRequest({ requestId: becameVacant.requests[0]._id, payload: { decisionReason: "Fallback" }, user: head, dependencies: becameVacant.dependencies }), /override reason/);
  assert.equal((await approveReassignmentRequest({ requestId: becameVacant.requests[0]._id, payload: { decisionReason: "Fallback", overrideReason: "Branch manager became vacant" }, user: head, dependencies: becameVacant.dependencies })).applied, true);
});

test("boundary manager requester is routed to Head for maker/checker", async () => {
  const f = makeFixture();
  const created = await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: branchManager, dependencies: f.dependencies });
  assert.equal(created.request.approvalLevel, "HEAD_OF_SALES");
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Own request" }, user: branchManager, dependencies: f.dependencies }), /Maker\/checker/);
});

test("same FSD is allowed when that FSD is currently valid in destination Area", async () => {
  const f = makeFixture();
  f.assignments.find((row) => id(row.employeeId) === id(oldFsd._id)).geographyId = areaB._id;
  f.users.find((row) => id(row._id) === id(oldFsd._id)).geography = areaB;
  const payload = transfer(areaB, oldFsd);
  const preview = await buildReassignmentPreview({ payload, user: head, dependencies: f.dependencies });
  assert.equal(preview.canSubmit, true);
  await createReassignmentRequest({ payload, user: head, dependencies: f.dependencies });
  await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Employee already moved" }, user: branchManager, dependencies: f.dependencies });
  assert.equal(f.mappings[1].primaryFsdId, oldFsd._id);
  assert.equal(f.mappings[1].geographyId, areaB._id);
});

test("destination FSD wrong Area, inactive status, and wrong level are blocked", async () => {
  const wrongArea = makeFixture();
  await assert.rejects(buildReassignmentPreview({ payload: transfer(areaB, fsdC), user: head, dependencies: wrongArea.dependencies }), /destination Area/);
  const inactive = makeFixture(); inactive.users.find((row) => id(row._id) === id(fsdB._id)).status = "disabled";
  await assert.rejects(buildReassignmentPreview({ payload: transfer(areaB, fsdB), user: head, dependencies: inactive.dependencies }), /must be active/);
  fsdB.status = "active";
  const wrongLevel = makeFixture();
  await assert.rejects(buildReassignmentPreview({ payload: transfer(areaB, branchManager), user: head, dependencies: wrongLevel.dependencies }), /structured L1|destination Area/);
});

test("inactive destination hierarchy blocks preview and approval", async () => {
  const previewFixture = makeFixture(); areaB.status = "inactive";
  await assert.rejects(buildReassignmentPreview({ payload: transfer(areaB, fsdB), user: head, dependencies: previewFixture.dependencies }), /Active Area path/);
  areaB.status = "active";
  const approvalFixture = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: approvalFixture.dependencies });
  areaB.status = "inactive";
  await assert.rejects(approveReassignmentRequest({ requestId: approvalFixture.requests[0]._id, payload: { decisionReason: "Approve" }, user: branchManager, dependencies: approvalFixture.dependencies }), (error) => error.errors?.includes("REQUEST_STALE"));
  areaB.status = "active";
});

test("stale current mapping and destination FSD movement block approval", async () => {
  const mappingChanged = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: mappingChanged.dependencies });
  mappingChanged.current.primaryFsdId = fsdC._id;
  await assert.rejects(approveReassignmentRequest({ requestId: mappingChanged.requests[0]._id, payload: { decisionReason: "Approve" }, user: branchManager, dependencies: mappingChanged.dependencies }), (error) => error.errors?.includes("REQUEST_STALE_CURRENT_MAPPING_CHANGED"));
  const fsdMoved = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: fsdMoved.dependencies });
  fsdMoved.assignments.find((row) => id(row.employeeId) === id(fsdB._id)).geographyId = areaC._id;
  await assert.rejects(approveReassignmentRequest({ requestId: fsdMoved.requests[0]._id, payload: { decisionReason: "Approve" }, user: branchManager, dependencies: fsdMoved.dependencies }), (error) => error.errors?.includes("REQUEST_STALE_NEW_FSD_GEOGRAPHY_CHANGED"));
});

test("former approver loses authority when Geography responsibility changes", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  const assignment = f.assignments.find((row) => row.hierarchyLevel === 3 && id(row.geographyId) === id(branchA._id));
  assignment.employeeId = otherBranchManager._id;
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Former manager" }, user: branchManager, dependencies: f.dependencies }), /current responsible BRANCH_MANAGER/);
  assert.equal((await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "New manager" }, user: otherBranchManager, dependencies: f.dependencies })).applied, true);
});

test("one open request covers same-Area and cross-Geography conflicts", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  const crossPreview = await buildReassignmentPreview({ payload: transfer(areaC, fsdC), user: head, dependencies: f.dependencies });
  assert.ok(crossPreview.blockers.includes("ACTIVE_REASSIGNMENT_REQUEST_EXISTS"));
});

test("repeat cross-Geography approval is idempotent and leaves exactly one current mapping", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approved" }, user: branchManager, dependencies: f.dependencies });
  const repeated = await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approved" }, user: branchManager, dependencies: f.dependencies });
  assert.equal(repeated.idempotent, true);
  assert.equal(f.mappings.filter((row) => row.isCurrent).length, 1);
});

test("effective history answers both owner and Area before and after transfer", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approved" }, user: branchManager, dependencies: f.dependencies });
  const before = await getReassignmentHistory({ accountId: f.account._id, at: "2026-08-23T11:59:59Z", user: head, dependencies: f.dependencies });
  const after = await getReassignmentHistory({ accountId: f.account._id, at: "2026-08-23T12:00:00Z", user: head, dependencies: f.dependencies });
  assert.equal(before.ownerAt.owner.fullName, oldFsd.fullName);
  assert.equal(before.ownerAt.geography.name, areaA.name);
  assert.equal(after.ownerAt.owner.fullName, fsdB.fullName);
  assert.equal(after.ownerAt.geography.name, areaB.name);
  assert.equal(after.requests[0].boundaryType, "CROSS_AREA_SAME_BRANCH");
  assert.equal(after.assignments.find((item) => item.isCurrent).primaryFsd.fullName, fsdB.fullName);
});

test("approval queue visibility is structured by current level and Geography", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaC, fsdC), user: head, dependencies: f.dependencies });
  assert.equal((await listReassignmentRequests({ query: { status: "PENDING" }, user: rsm, dependencies: f.dependencies })).length, 1);
  assert.equal((await listReassignmentRequests({ query: { status: "PENDING" }, user: branchManager, dependencies: f.dependencies })).length, 0);
  assert.equal((await listReassignmentRequests({ query: { status: "PENDING" }, user: otherRsm, dependencies: f.dependencies })).length, 0);
  assert.equal((await listReassignmentRequests({ query: { status: "PENDING" }, user: head, dependencies: f.dependencies })).length, 1);
});

test("maker/checker requests leave the maker's approval queue and route only to Head", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaC, fsdC), user: rsm, dependencies: f.dependencies });
  assert.equal((await listApprovalQueue({ user: rsm, dependencies: f.dependencies })).length, 0);
  assert.equal((await listApprovalQueue({ user: branchManager, dependencies: f.dependencies })).length, 0);
  assert.equal((await listApprovalQueue({ user: head, dependencies: f.dependencies })).length, 1);
});

test("rejection preserves Distributor ownership and emits transfer-specific audit", async () => {
  const f = makeFixture();
  await createReassignmentRequest({ payload: transfer(areaB, fsdB), user: head, dependencies: f.dependencies });
  await rejectReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Market move rejected" }, user: branchManager, dependencies: f.dependencies });
  assert.equal(f.current.isCurrent, true);
  assert.equal(f.account.assignedTo, oldFsd._id);
  assert.deepEqual(f.audits.map((entry) => entry.action), ["DISTRIBUTOR_TRANSFER_REQUESTED", "DISTRIBUTOR_TRANSFER_REJECTED"]);
  assert.equal(f.audits[1].metadata.requesterId, head._id);
  assert.equal(f.audits[1].metadata.approverId, branchManager._id);
  assert.equal(f.audits[1].metadata.reason, "Approved market boundary transfer");
});
