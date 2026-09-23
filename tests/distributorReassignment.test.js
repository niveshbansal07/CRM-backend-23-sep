const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  buildReassignmentPreview,
  createReassignmentRequest,
  approveReassignmentRequest,
  rejectReassignmentRequest,
  cancelReassignmentRequest,
  getReassignmentHistory,
  loadCurrentMappingStrict,
} = require("../src/services/distributorReassignment.service");

const oid = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const id = (value) => String(value?._id || value?.id || value || "");
const companyA = oid(1);
const companyB = oid(2);
const area = { _id: oid(10), companyId: companyA, name: "Budhana", code: "AREA-BUD", type: "AREA", status: "active", deletedAt: null };
const otherArea = { _id: oid(11), companyId: companyA, name: "Khatauli", code: "AREA-KHA", type: "AREA", status: "active", deletedAt: null };
const asm = { _id: oid(20), companyId: companyA, fullName: "Anita ASM", employeeId: "ASM-1", role: "sales_manager", status: "active", deletedAt: null };
const unrelatedAsm = { _id: oid(21), companyId: companyA, fullName: "Other ASM", role: "sales_manager", status: "active", deletedAt: null };
const head = { _id: oid(22), companyId: companyA, fullName: "Harish Head", role: "sales_head", status: "active", deletedAt: null };
const admin = { _id: oid(23), companyId: companyA, fullName: "Company Admin", role: "company_admin", status: "active", deletedAt: null };
const oldFsd = { _id: oid(30), companyId: companyA, fullName: "Amit FSD", employeeId: "FSD-1", role: "sales_executive", status: "active", reportingManagerId: asm._id, deletedAt: null };
const newFsd = { _id: oid(31), companyId: companyA, fullName: "Rohit FSD", employeeId: "FSD-2", role: "sales_executive", status: "active", reportingManagerId: asm._id, deletedAt: null };
const movedFsd = { _id: oid(32), companyId: companyA, fullName: "Moved FSD", employeeId: "FSD-3", role: "sales_executive", status: "active", reportingManagerId: unrelatedAsm._id, deletedAt: null };
const accountId = oid(40);

const fakeSession = () => ({
  startTransaction() { this.started = true; },
  async commitTransaction() { this.committed = true; },
  async abortTransaction() { this.aborted = true; },
  async endSession() { this.ended = true; },
});

const matches = (record, query) => Object.entries(query || {}).every(([key, expected]) => {
  const actual = record[key];
  if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.some((item) => id(item) === id(actual));
  return id(actual) === id(expected);
});

const model = (rows) => ({
  find: (query) => Promise.resolve(rows.filter((row) => matches(row, query))),
  findOne: (query) => Promise.resolve(rows.find((row) => matches(row, query)) || null),
});

const makeRequestDocument = (value, requests) => ({
  _id: value._id || oid(70 + requests.length),
  createdAt: value.createdAt || new Date("2026-08-23T10:00:00.000Z"),
  deletedAt: null,
  ...value,
  async save() {
    this.isOpen = ["PENDING", "APPROVED"].includes(this.status);
    return this;
  },
});

const fixture = ({ asmVacant = false, oldInactive = false, mirrorConflict = false, newInactive = false } = {}) => {
  const account = {
    _id: accountId, companyId: companyA, name: "ABC Distributor", status: "active", deletedAt: null,
    assignedTo: mirrorConflict ? unrelatedAsm._id : oldFsd._id, reportingManagerId: asm._id,
    accountTypeId: { _id: oid(41), code: "DISTRIBUTOR", name: "Distributor" },
    async save() { this.saveCount = (this.saveCount || 0) + 1; return this; },
    toObject() { return { ...this }; },
  };
  const current = {
    _id: oid(50), companyId: companyA, distributorAccountId: accountId, geographyId: area._id,
    geographyType: "AREA", primaryFsdId: oldFsd._id, effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: null, status: "current", isCurrent: true, operationId: oid(51), createdBy: head._id,
    assignmentReason: "Initial ownership", deletedAt: null,
  };
  const mappings = [current];
  const requests = [];
  const audits = [];
  const users = [asm, unrelatedAsm, head, admin, { ...oldFsd, status: oldInactive ? "disabled" : "active" }, { ...newFsd, status: newInactive ? "disabled" : "active" }, movedFsd];
  const assignments = [
    ...(!asmVacant ? [{ _id: oid(60), companyId: companyA, employeeId: asm._id, geographyId: area._id, geographyType: "AREA", hierarchyLevel: 2, isCurrent: true, isResponsibleManager: true, deletedAt: null }] : []),
    { _id: oid(61), companyId: companyA, employeeId: oldFsd._id, geographyId: area._id, geographyType: "AREA", hierarchyLevel: 1, isCurrent: true, isResponsibleManager: false, deletedAt: null },
    { _id: oid(62), companyId: companyA, employeeId: newFsd._id, geographyId: area._id, geographyType: "AREA", hierarchyLevel: 1, isCurrent: true, isResponsibleManager: false, deletedAt: null },
    { _id: oid(63), companyId: companyA, employeeId: movedFsd._id, geographyId: otherArea._id, geographyType: "AREA", hierarchyLevel: 1, isCurrent: true, isResponsibleManager: false, deletedAt: null },
  ];
  const session = fakeSession();
  const dependencies = {
    Account: model([account]),
    User: model(users),
    Geography: model([area, otherArea]),
    EmployeeAssignment: model(assignments),
    DistributorMapping: {
      ...model(mappings),
      async updateOne(query, update) {
        const mapping = mappings.find((item) => matches(item, query));
        if (!mapping) return { modifiedCount: 0 };
        Object.assign(mapping, update.$set);
        return { modifiedCount: 1 };
      },
      async create(values) {
        const docs = values.map((value, index) => ({ _id: oid(80 + mappings.length + index), deletedAt: null, ...value }));
        mappings.push(...docs);
        return docs;
      },
    },
    ReassignmentRequest: {
      ...model(requests),
      async create(values) {
        const docs = values.map((value) => makeRequestDocument(value, requests));
        requests.push(...docs);
        return docs;
      },
    },
    loadDistributorAccount: async ({ accountId: requested, companyId }) => {
      if (id(requested) !== id(account._id) || id(companyId) !== id(companyA)) {
        throw Object.assign(new Error("Distributor Account not found"), { statusCode: 404 });
      }
      return account;
    },
    validateArea: async ({ areaId, companyId }) => {
      if (id(areaId) !== id(area._id) || id(companyId) !== id(companyA)) throw Object.assign(new Error("Area not found"), { statusCode: 404 });
      return { target: area, path: { zone: { id: oid(12), name: "North" }, region: { id: oid(13), name: "West" }, branch: { id: oid(14), name: "Main" }, area: { id: area._id, name: area.name } } };
    },
    findEmployeeContext: async ({ employeeId, companyId }) => {
      const employee = users.find((item) => id(item._id) === id(employeeId) && id(item.companyId) === id(companyId));
      if (!employee) throw Object.assign(new Error("Employee not found"), { statusCode: 404 });
      const level = id(employee._id) === id(asm._id) ? 2 : 1;
      return { employee, identity: { valid: true, hierarchyLevel: level, technicalRole: level === 2 ? "sales_manager" : "sales_executive", designation: { title: level === 2 ? "ASM" : "FSD" } }, department: { name: "Sales" } };
    },
    findCurrentAssignment: async ({ employeeId }) => assignments.find((item) => id(item.employeeId) === id(employeeId) && item.isCurrent && !item.deletedAt) || null,
    validatePrimaryFsd: async ({ fsdId, areaId, companyId }) => {
      const employee = users.find((item) => id(item._id) === id(fsdId) && id(item.companyId) === id(companyId));
      if (!employee) throw Object.assign(new Error("Primary FSD not found"), { statusCode: 404 });
      if (employee.role !== "sales_executive") throw Object.assign(new Error("Primary FSD must have an unambiguous structured L1 Sales designation"), { statusCode: 400 });
      if (employee.status !== "active") throw Object.assign(new Error("Primary FSD must be active"), { statusCode: 409 });
      const assignment = assignments.find((item) => id(item.employeeId) === id(fsdId) && item.isCurrent);
      if (!assignment || id(assignment.geographyId) !== id(areaId)) throw Object.assign(new Error("Primary FSD Geography must match the Distributor Area"), { statusCode: 409 });
      return { context: { employee, identity: { valid: true, hierarchyLevel: 1, technicalRole: "sales_executive", designation: { title: "FSD" } }, department: { name: "Sales" } }, assignment };
    },
    buildSupervisoryOwnership: async ({ primaryFsdContext }) => ({
      chain: { asm: asmVacant ? null : { id: asm._id, fullName: asm.fullName }, branchManager: null, rsm: null, zsm: null, headOfSales: { id: head._id, fullName: head.fullName } },
      warnings: asmVacant ? ["ASM_VACANT"] : [],
      primaryFsdContext,
    }),
    evaluateCurrentMapping: async () => ({ state: oldInactive ? "PRIMARY_FSD_INACTIVE" : "MAPPED_VALID", requiresReassignment: oldInactive, warnings: oldInactive ? ["REASSIGNMENT_REQUIRED"] : [] }),
    listDistributorMappingReadiness: async () => ({ summary: {}, distributors: [] }),
    writeAuditLog: async (entry) => { audits.push(entry); return entry; },
    startSession: async () => session,
    now: () => new Date("2026-08-23T12:00:00.000Z"),
    newOperationId: () => oid(90),
  };
  return { account, current, mappings, requests, audits, assignments, users, session, dependencies };
};

const intent = { distributorAccountId: accountId, newPrimaryFsdId: newFsd._id, reason: "Territory coverage continuity" };

test("zero-write preview preserves Area and resolves current ASM approval", async () => {
  const f = fixture();
  const preview = await buildReassignmentPreview({ payload: intent, user: head, dependencies: f.dependencies });
  assert.equal(preview.canSubmit, true);
  assert.equal(preview.area.area.name, "Budhana");
  assert.equal(preview.oldPrimaryFsd.fullName, "Amit FSD");
  assert.equal(preview.newPrimaryFsd.fullName, "Rohit FSD");
  assert.equal(preview.approval.level, "ASM");
  assert.equal(preview.accountMirror.consistent, true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.account.saveCount, undefined);
  assert.equal(f.audits.length, 0);
});

test("request creation changes no mapping or Account ownership", async () => {
  const f = fixture({ oldInactive: true });
  const result = await createReassignmentRequest({ payload: intent, user: head, dependencies: f.dependencies });
  assert.equal(result.request.status, "PENDING");
  assert.equal(f.current.isCurrent, true);
  assert.equal(f.account.assignedTo, oldFsd._id);
  assert.equal(f.account.saveCount, undefined);
  assert.equal(f.audits[0].action, "DISTRIBUTOR_REASSIGNMENT_REQUESTED");
  assert.equal(f.session.committed, true);
});

test("ASM approval atomically closes old mapping, opens linked mapping, and synchronizes mirrors", async () => {
  const f = fixture({ oldInactive: true });
  await createReassignmentRequest({ payload: intent, user: head, dependencies: f.dependencies });
  const result = await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Coverage verified" }, user: asm, dependencies: f.dependencies });
  assert.equal(result.applied, true);
  assert.equal(f.current.isCurrent, false);
  assert.equal(f.mappings.length, 2);
  assert.equal(f.mappings[1].isCurrent, true);
  assert.equal(f.mappings[1].geographyId, area._id);
  assert.equal(f.mappings[1].primaryFsdId, newFsd._id);
  assert.equal(f.mappings[1].previousAssignmentId, f.current._id);
  assert.equal(f.current.endedOperationId, f.requests[0].operationId);
  assert.equal(f.current.effectiveTo.toISOString(), f.mappings[1].effectiveFrom.toISOString());
  assert.equal(f.account.assignedTo, newFsd._id);
  assert.equal(f.account.reportingManagerId, asm._id);
  assert.equal(f.requests[0].status, "APPLIED");
  assert.deepEqual(f.audits.map((item) => item.action), ["DISTRIBUTOR_REASSIGNMENT_REQUESTED", "DISTRIBUTOR_REASSIGNMENT_APPROVED", "DISTRIBUTOR_REASSIGNED"]);
});

test("repeat approval is idempotent and creates no second mapping", async () => {
  const f = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: f.dependencies });
  await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approved" }, user: asm, dependencies: f.dependencies });
  const second = await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approved" }, user: asm, dependencies: f.dependencies });
  assert.equal(second.idempotent, true);
  assert.equal(f.mappings.length, 2);
});

test("cross-Area candidate is explicitly rejected without changing Distributor Geography", async () => {
  const f = fixture();
  await assert.rejects(
    buildReassignmentPreview({ payload: { ...intent, newPrimaryFsdId: movedFsd._id }, user: head, dependencies: f.dependencies }),
    (error) => error.errors?.includes("CROSS_AREA_REASSIGNMENT_NOT_SUPPORTED_IN_PHASE_5A")
  );
  assert.equal(f.current.geographyId, area._id);
});

test("same FSD, mirror conflict, inactive Distributor, and duplicate request are blockers", async () => {
  const same = fixture();
  assert.ok((await buildReassignmentPreview({ payload: { ...intent, newPrimaryFsdId: oldFsd._id }, user: head, dependencies: same.dependencies })).blockers.includes("SAME_FSD_NOT_REASSIGNMENT"));
  const mirror = fixture({ mirrorConflict: true });
  assert.ok((await buildReassignmentPreview({ payload: intent, user: head, dependencies: mirror.dependencies })).blockers.includes("ASSIGNEE_MIRROR_CONFLICT"));
  const inactive = fixture(); inactive.account.status = "inactive";
  assert.ok((await buildReassignmentPreview({ payload: intent, user: head, dependencies: inactive.dependencies })).blockers.includes("DISTRIBUTOR_INACTIVE"));
  const duplicate = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: duplicate.dependencies });
  assert.ok((await buildReassignmentPreview({ payload: intent, user: head, dependencies: duplicate.dependencies })).blockers.includes("ACTIVE_REASSIGNMENT_REQUEST_EXISTS"));
});

test("inactive proposed FSD and wrong level are blocked while inactive old FSD is allowed", async () => {
  const inactiveNew = fixture({ newInactive: true });
  await assert.rejects(buildReassignmentPreview({ payload: intent, user: head, dependencies: inactiveNew.dependencies }), /must be active/);
  const wrong = fixture();
  await assert.rejects(buildReassignmentPreview({ payload: { ...intent, newPrimaryFsdId: asm._id }, user: head, dependencies: wrong.dependencies }), /structured L1/);
  const inactiveOld = fixture({ oldInactive: true });
  assert.equal((await buildReassignmentPreview({ payload: intent, user: head, dependencies: inactiveOld.dependencies })).canSubmit, true);
});

test("no current mapping and multiple current mappings are integrity failures", async () => {
  const none = fixture(); none.mappings.splice(0);
  await assert.rejects(loadCurrentMappingStrict({ accountId, companyId: companyA, dependencies: none.dependencies }), (error) => error.errors?.includes("NO_CURRENT_MAPPING"));
  const duplicate = fixture(); duplicate.mappings.push({ ...duplicate.current, _id: oid(99) });
  await assert.rejects(loadCurrentMappingStrict({ accountId, companyId: companyA, dependencies: duplicate.dependencies }), (error) => error.errors?.includes("DATA_INTEGRITY_CONFLICT"));
});

test("stale current mapping and moved proposed FSD block approval", async () => {
  const changed = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: changed.dependencies });
  changed.current.primaryFsdId = movedFsd._id;
  await assert.rejects(approveReassignmentRequest({ requestId: changed.requests[0]._id, payload: { decisionReason: "Approve" }, user: asm, dependencies: changed.dependencies }), (error) => error.errors?.includes("REQUEST_STALE_CURRENT_MAPPING_CHANGED"));
  const moved = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: moved.dependencies });
  moved.assignments.find((item) => id(item.employeeId) === id(newFsd._id)).geographyId = otherArea._id;
  await assert.rejects(approveReassignmentRequest({ requestId: moved.requests[0]._id, payload: { decisionReason: "Approve" }, user: asm, dependencies: moved.dependencies }), (error) => error.errors?.includes("REQUEST_STALE"));
});

test("only current Area ASM standard-approves and maker/checker routes ASM requests to Head", async () => {
  const f = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: f.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approve" }, user: unrelatedAsm, dependencies: f.dependencies }), /current responsible Area ASM/);
  const maker = fixture();
  const created = await createReassignmentRequest({ payload: intent, user: asm, dependencies: maker.dependencies });
  assert.equal(created.request.approvalLevel, "HEAD_OF_SALES");
  await assert.rejects(approveReassignmentRequest({ requestId: maker.requests[0]._id, payload: { decisionReason: "Approve" }, user: asm, dependencies: maker.dependencies }), /Maker\/checker/);
});

test("ASM vacancy requires Head fallback and Head self-approval requires explicit override reason", async () => {
  const f = fixture({ asmVacant: true });
  const created = await createReassignmentRequest({ payload: intent, user: head, dependencies: f.dependencies });
  assert.equal(created.request.approvalLevel, "HEAD_OF_SALES");
  assert.ok(created.warnings.includes("ASM_VACANT_HEAD_APPROVAL_REQUIRED"));
  await assert.rejects(approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Emergency" }, user: head, dependencies: f.dependencies }), /override reason/);
  const result = await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Emergency", overrideReason: "ASM seat vacant" }, user: head, dependencies: f.dependencies });
  assert.equal(result.applied, true);
});

test("Head operational override is controlled and platform admin may bypass", async () => {
  const headOverride = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: headOverride.dependencies });
  await assert.rejects(approveReassignmentRequest({ requestId: headOverride.requests[0]._id, payload: { decisionReason: "Urgent", override: true }, user: head, dependencies: headOverride.dependencies }), /override reason/);
  assert.equal((await approveReassignmentRequest({ requestId: headOverride.requests[0]._id, payload: { decisionReason: "Urgent", override: true, overrideReason: "Operational continuity" }, user: head, dependencies: headOverride.dependencies })).applied, true);
  const adminBypass = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: adminBypass.dependencies });
  assert.equal((await approveReassignmentRequest({ requestId: adminBypass.requests[0]._id, payload: { decisionReason: "Controlled admin recovery" }, user: admin, dependencies: adminBypass.dependencies })).applied, true);
});

test("rejection and cancellation are historical terminal states with no ownership change", async () => {
  const rejected = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: rejected.dependencies });
  await rejectReassignmentRequest({ requestId: rejected.requests[0]._id, payload: { decisionReason: "Coverage not ready" }, user: asm, dependencies: rejected.dependencies });
  assert.equal(rejected.requests[0].status, "REJECTED");
  assert.equal(rejected.current.isCurrent, true);
  assert.equal(rejected.account.assignedTo, oldFsd._id);
  const cancelled = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: cancelled.dependencies });
  await cancelReassignmentRequest({ requestId: cancelled.requests[0]._id, payload: { decisionReason: "Request withdrawn" }, user: head, dependencies: cancelled.dependencies });
  assert.equal(cancelled.requests[0].status, "CANCELLED");
  assert.equal(cancelled.mappings.length, 1);
});

test("effective-dated history answers who owned the Distributor at a timestamp", async () => {
  const f = fixture();
  await createReassignmentRequest({ payload: intent, user: head, dependencies: f.dependencies });
  await approveReassignmentRequest({ requestId: f.requests[0]._id, payload: { decisionReason: "Approved" }, user: asm, dependencies: f.dependencies });
  const before = await getReassignmentHistory({ accountId, at: "2026-08-23T11:59:59.000Z", user: head, dependencies: f.dependencies });
  const after = await getReassignmentHistory({ accountId, at: "2026-08-23T12:00:00.000Z", user: head, dependencies: f.dependencies });
  assert.equal(before.ownerAt.owner.fullName, oldFsd.fullName);
  assert.equal(after.ownerAt.owner.fullName, newFsd.fullName);
  assert.equal(after.requests[0].status, "APPLIED");
});

test("tenant isolation rejects foreign company context", async () => {
  const f = fixture();
  const foreignHead = { ...head, _id: oid(100), companyId: companyB };
  await assert.rejects(buildReassignmentPreview({ payload: intent, user: foreignHead, dependencies: f.dependencies }), /not found/);
});
