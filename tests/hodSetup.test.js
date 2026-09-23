const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HOD_SETUP_STATUSES,
  assertCompanyAdmin,
  isHumanResourceDepartment,
  resolveDepartmentStatus,
  resolveHodAccess,
  listDepartmentHodStatuses,
  createDepartmentHod,
} = require("../src/services/hodSetup.service");
const {
  validateHodDepartmentId,
  validateHodSetupPayload,
} = require("../src/validators/hodSetup.validator");
const { getDefaultPermissionsForRole, sanitizePermissions } = require("../src/services/permission.service");

const queryResult = (getValue) => {
  const read = () => (typeof getValue === "function" ? getValue() : getValue);
  const query = {
    sort() {
      return query;
    },
    session() {
      return Promise.resolve(read());
    },
    then(resolve, reject) {
      return Promise.resolve(read()).then(resolve, reject);
    },
  };
  return query;
};

const makeDepartment = (overrides = {}) => ({
  _id: "department-finance",
  companyId: "company-a",
  name: "Finance",
  normalizedName: "finance",
  slug: "finance",
  code: "FIN",
  status: "active",
  isActive: true,
  isArchived: false,
  deletedAt: null,
  ...overrides,
});

const makeDesignation = (overrides = {}) => ({
  _id: "designation-finance-head",
  companyId: "company-a",
  departmentId: "department-finance",
  name: "Head of Finance",
  title: "Head of Finance",
  code: "HOD_FIN",
  hierarchyLevel: 6,
  isDepartmentHead: true,
  isHead: true,
  mappedRole: "",
  status: "active",
  isArchived: false,
  deletedAt: null,
  createdAt: new Date("2026-01-01"),
  ...overrides,
});

const validPayload = (overrides = {}) => ({
  fullName: "Asha Mehta",
  email: "asha@company.test",
  password: "temporary123",
  phone: "+91 9876543210",
  employeeId: "FIN-HOD-001",
  joiningDate: new Date("2026-08-11"),
  ...overrides,
});

const companyAdmin = (overrides = {}) => ({
  _id: "admin-a",
  companyId: "company-a",
  role: "company_admin",
  systemRole: "company_admin",
  status: "active",
  ...overrides,
});

const makeHarness = ({
  department = makeDepartment(),
  designations = [makeDesignation()],
  users = [],
  requests = [],
  owner = companyAdmin(),
} = {}) => {
  const state = {
    department,
    designations: [...designations],
    users: [owner, ...users],
    requests: [...requests],
    audits: [],
    cacheInvalidations: [],
    createdPayloads: [],
    sessionCount: 0,
    lockOwner: null,
    lockWaiters: [],
  };

  const releaseLock = (session) => {
    if (state.lockOwner !== session) return;
    state.lockOwner = null;
    const next = state.lockWaiters.shift();
    if (next) next();
  };

  const startSession = async () => {
    const session = {
      id: ++state.sessionCount,
      startTransaction() {},
      async commitTransaction() {
        releaseLock(session);
      },
      async abortTransaction() {
        releaseLock(session);
      },
      async endSession() {},
    };
    return session;
  };

  const waitForDepartmentLock = async (session) => {
    while (state.lockOwner && state.lockOwner !== session) {
      await new Promise((resolve) => state.lockWaiters.push(resolve));
    }
    state.lockOwner = session;
  };

  const dependencies = {
    Department: {
      find: (query) =>
        queryResult(() =>
          state.department && String(state.department.companyId) === String(query.companyId)
            ? [state.department]
            : []
        ),
      findOne: (query) =>
        queryResult(() => {
          if (!state.department) return null;
          if (String(query._id) !== String(state.department._id)) return null;
          if (String(query.companyId) !== String(state.department.companyId)) return null;
          if (state.department.deletedAt) return null;
          return state.department;
        }),
      findOneAndUpdate: async (query, update, options) => {
        await waitForDepartmentLock(options.session);
        if (!state.department) return null;
        if (String(query._id) !== String(state.department._id)) return null;
        if (String(query.companyId) !== String(state.department.companyId)) return null;
        if (state.department.status !== "active" || state.department.isArchived || state.department.deletedAt) {
          return null;
        }
        state.department.updatedAt = update.$set.updatedAt;
        return state.department;
      },
    },
    Designation: {
      find: (query) =>
        queryResult(() =>
          state.designations
            .filter(
              (item) =>
                String(item.companyId) === String(query.companyId) &&
                String(item.departmentId) === String(query.departmentId) &&
                item.status === "active" &&
                item.isArchived !== true &&
                !item.deletedAt
            )
            .sort((a, b) => b.hierarchyLevel - a.hierarchyLevel)
        ),
    },
    EmployeeRequest: {
      findOne: (query) =>
        queryResult(() =>
          state.requests.find(
            (item) =>
              String(item.companyId) === String(query.companyId) &&
              String(item.requestedDepartmentId) === String(query.requestedDepartmentId) &&
              query.requestedDesignationId.$in.map(String).includes(String(item.requestedDesignationId)) &&
              query.status.$in.includes(item.status) &&
              !item.deletedAt
          ) || null
        ),
    },
    User: {
      findOne: (query) =>
        queryResult(() => {
          if (query.designationId?.$in) {
            return (
              state.users.find(
                (item) =>
                  String(item.companyId) === String(query.companyId) &&
                  String(item.departmentId) === String(query.departmentId) &&
                  query.designationId.$in.map(String).includes(String(item.designationId)) &&
                  item.status === "active" &&
                  !item.deletedAt
              ) || null
            );
          }
          if (query.email) {
            return state.users.find((item) => item.email === query.email && !item.deletedAt) || null;
          }
          if (query.employeeId) {
            return (
              state.users.find(
                (item) =>
                  String(item.companyId) === String(query.companyId) &&
                  item.employeeId === query.employeeId &&
                  !item.deletedAt
              ) || null
            );
          }
          if (query._id) {
            return (
              state.users.find(
                (item) =>
                  String(item._id) === String(query._id) &&
                  String(item.companyId) === String(query.companyId) &&
                  item.role === query.role &&
                  item.status === "active" &&
                  !item.deletedAt
              ) || null
            );
          }
          return null;
        }),
      create: async (payloads) => {
        const created = {
          _id: `hod-${state.createdPayloads.length + 1}`,
          ...payloads[0],
          createdAt: new Date(),
        };
        state.createdPayloads.push(payloads[0]);
        state.users.push(created);
        return [created];
      },
    },
    Company: {
      findOne: (query) =>
        queryResult(() =>
          String(query._id) === "company-a" && owner
            ? { _id: "company-a", ownerUserId: owner._id, status: "active", deletedAt: null }
            : null
        ),
    },
    startSession,
    hashPassword: async (password) => `HASHED:${password}`,
    validateReportingManagerAssignment: async ({ reportingManagerId }) => ({ reportingManagerId }),
    getDefaultPermissionsForRole,
    sanitizePermissions,
    writeAuditLog: async (entry) => {
      state.audits.push(entry);
      return entry;
    },
    invalidateOrgTreeCache: (companyId) => state.cacheInvalidations.push(String(companyId)),
  };

  return { state, dependencies };
};

const runPayloadValidator = (body) => {
  const req = { body };
  let response = null;
  const res = {
    status(statusCode) {
      return {
        json(payload) {
          response = { statusCode, payload };
          return response;
        },
      };
    },
  };
  let nextCalled = false;
  validateHodSetupPayload(req, res, () => {
    nextCalled = true;
  });
  return { req, response, nextCalled };
};

test("Company Admin is the only role accepted by the service", () => {
  assert.doesNotThrow(() => assertCompanyAdmin(companyAdmin()));
  for (const role of [
    "super_admin",
    "sub_admin",
    "hr_head",
    "hr_manager",
    "hr_executive",
    "sales_head",
    "sales_manager",
    "sales_executive",
    "manager",
    "employee",
    "user",
  ]) {
    assert.throws(() => assertCompanyAdmin(companyAdmin({ role, systemRole: role })), /Only Company Admin/);
  }
});

test("Human Resource aliases are delegated to the existing HR setup flow", () => {
  assert.equal(isHumanResourceDepartment(makeDepartment({ name: "Human Resource", normalizedName: "human resource" })), true);
  assert.equal(isHumanResourceDepartment(makeDepartment({ name: "Human Resources", slug: "human-resources" })), true);
  assert.equal(isHumanResourceDepartment(makeDepartment()), false);
});

test("generic HOD resolves to manager with self scope and no custom permissions", () => {
  const access = resolveHodAccess({
    department: makeDepartment(),
    designation: makeDesignation(),
    companyId: "company-a",
  });
  assert.deepEqual(access, {
    role: "manager",
    systemRole: "manager",
    permissionScope: "self",
    customPermissions: [],
  });
});

test("Sales HOD resolves to Sales Head and receives existing default permissions", () => {
  const access = resolveHodAccess({
    department: makeDepartment({ name: "Sales", normalizedName: "sales", slug: "sales" }),
    designation: makeDesignation({ title: "Head of Sales", name: "Head of Sales" }),
    companyId: "company-a",
  });
  assert.equal(access.role, "sales_head");
  assert.equal(access.systemRole, "sales_head");
  assert.equal(access.permissionScope, "self");
  assert.deepEqual(access.customPermissions, getDefaultPermissionsForRole("sales_head"));
});

test("status resolver derives all five non-persisted states", () => {
  const active = makeDepartment();
  const inactive = makeDepartment({ status: "inactive", isActive: false });
  const designation = makeDesignation();
  assert.equal(resolveDepartmentStatus({ department: active, designation, hod: {}, inProgressRequest: null }), HOD_SETUP_STATUSES.READY);
  assert.equal(resolveDepartmentStatus({ department: active, designation, hod: null, inProgressRequest: {} }), HOD_SETUP_STATUSES.SETUP_IN_PROGRESS);
  assert.equal(resolveDepartmentStatus({ department: active, designation, hod: null, inProgressRequest: null }), HOD_SETUP_STATUSES.SETUP_REQUIRED);
  assert.equal(resolveDepartmentStatus({ department: active, designation: null, hod: null, inProgressRequest: null }), HOD_SETUP_STATUSES.MISSING_HEAD_DESIGNATION);
  assert.equal(resolveDepartmentStatus({ department: inactive, designation: null, hod: null, inProgressRequest: null }), HOD_SETUP_STATUSES.INACTIVE);
});

test("payload validator requires a complete HOD profile", () => {
  const result = runPayloadValidator({});
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.statusCode, 400);
  assert.match(result.response.payload.errors.join(" "), /Full name/);
  assert.match(result.response.payload.errors.join(" "), /Joining date/);
});

test("payload validator normalizes valid business fields", () => {
  const result = runPayloadValidator({
    fullName: "  Asha   Mehta ",
    email: " ASHA@COMPANY.TEST ",
    password: "secret1",
    phone: "  +91 99999 99999 ",
    employeeId: " FIN-001 ",
    joiningDate: "2026-08-11",
  });
  assert.equal(result.nextCalled, true);
  assert.equal(result.req.validatedBody.fullName, "Asha Mehta");
  assert.equal(result.req.validatedBody.email, "asha@company.test");
  assert.equal(result.req.validatedBody.employeeId, "FIN-001");
  assert.equal(result.req.validatedBody.joiningDate instanceof Date, true);
});

test("payload validator rejects client-controlled authority and access fields", () => {
  const result = runPayloadValidator({
    ...validPayload({ joiningDate: "2026-08-11" }),
    companyId: "company-b",
    role: "super_admin",
    designationId: "designation-other",
    reportingManagerId: "attacker",
    setupCompleted: false,
  });
  assert.equal(result.nextCalled, false);
  assert.match(result.response.payload.errors.join(" "), /controlled by the server/);
});

test("Department id validator rejects malformed IDs", () => {
  let response;
  validateHodDepartmentId(
    { params: { departmentId: "not-an-id" } },
    { status: (statusCode) => ({ json: (payload) => (response = { statusCode, payload }) }) },
    () => assert.fail("next must not be called")
  );
  assert.equal(response.statusCode, 400);
});

test("generic HOD creation reuses designation and assigns Company Admin", async () => {
  const { state, dependencies } = makeHarness();
  const result = await createDepartmentHod({
    departmentId: "department-finance",
    payload: validPayload(),
    user: companyAdmin(),
    dependencies,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.headDesignation._id, "designation-finance-head");
  assert.equal(result.hod.role, "manager");
  assert.equal(result.hod.reportingManagerId, "admin-a");
  assert.equal(state.designations.length, 1, "HOD setup must not create a Designation");
});

test("Sales HOD creation persists Sales Head access and default permissions", async () => {
  const department = makeDepartment({
    _id: "department-sales",
    name: "Sales",
    normalizedName: "sales",
    slug: "sales",
  });
  const designation = makeDesignation({
    _id: "designation-sales-head",
    departmentId: "department-sales",
    name: "Head of Sales",
    title: "Head of Sales",
  });
  const { state, dependencies } = makeHarness({ department, designations: [designation] });
  await createDepartmentHod({
    departmentId: "department-sales",
    payload: validPayload({ employeeId: "SALES-HOD-001" }),
    user: companyAdmin(),
    dependencies,
  });
  assert.equal(state.createdPayloads[0].role, "sales_head");
  assert.equal(state.createdPayloads[0].systemRole, "sales_head");
  assert.deepEqual(state.createdPayloads[0].customPermissions, getDefaultPermissionsForRole("sales_head"));
});

test("generic POST rejects Human Resources without modifying HR setup", async () => {
  const department = makeDepartment({ name: "Human Resource", normalizedName: "human resource", slug: "human-resource" });
  const { state, dependencies } = makeHarness({ department });
  await assert.rejects(
    createDepartmentHod({ departmentId: department._id, payload: validPayload(), user: companyAdmin(), dependencies }),
    /existing HR setup flow/
  );
  assert.equal(state.createdPayloads.length, 0);
});

test("cross-tenant and nonexistent Departments share not-found behavior", async () => {
  const { dependencies } = makeHarness();
  await assert.rejects(
    createDepartmentHod({
      departmentId: "department-finance",
      payload: validPayload(),
      user: companyAdmin({ companyId: "company-b" }),
      dependencies,
    }),
    (error) => error.statusCode === 404 && /Department not found/.test(error.message)
  );
});

test("inactive Department cannot be configured", async () => {
  const department = makeDepartment({ status: "inactive", isActive: false });
  const { dependencies } = makeHarness({ department });
  await assert.rejects(
    createDepartmentHod({ departmentId: department._id, payload: validPayload(), user: companyAdmin(), dependencies }),
    (error) => error.statusCode === 409 && /inactive/.test(error.message)
  );
});

test("existing active HOD is rejected", async () => {
  const existingHod = {
    _id: "hod-existing",
    companyId: "company-a",
    departmentId: "department-finance",
    designationId: "designation-finance-head",
    role: "manager",
    status: "active",
    deletedAt: null,
  };
  const { dependencies } = makeHarness({ users: [existingHod] });
  await assert.rejects(
    createDepartmentHod({ departmentId: "department-finance", payload: validPayload(), user: companyAdmin(), dependencies }),
    (error) => error.statusCode === 409 && /already configured/.test(error.message)
  );
});

test("legacy in-progress head request blocks setup", async () => {
  const request = {
    _id: "request-1",
    companyId: "company-a",
    requestedDepartmentId: "department-finance",
    requestedDesignationId: "designation-finance-head",
    status: "setup_pending",
    deletedAt: null,
  };
  const { dependencies } = makeHarness({ requests: [request] });
  await assert.rejects(
    createDepartmentHod({ departmentId: "department-finance", payload: validPayload(), user: companyAdmin(), dependencies }),
    (error) => error.statusCode === 409 && /already in progress/.test(error.message)
  );
});

test("missing head designation fails without creating one", async () => {
  const { state, dependencies } = makeHarness({ designations: [] });
  await assert.rejects(
    createDepartmentHod({ departmentId: "department-finance", payload: validPayload(), user: companyAdmin(), dependencies }),
    (error) => error.statusCode === 409 && /designation is missing/.test(error.message)
  );
  assert.equal(state.designations.length, 0);
  assert.equal(state.createdPayloads.length, 0);
});

test("duplicate work email is rejected", async () => {
  const duplicate = { _id: "other", companyId: "company-b", email: "asha@company.test", status: "active" };
  const { dependencies } = makeHarness({ users: [duplicate] });
  await assert.rejects(
    createDepartmentHod({ departmentId: "department-finance", payload: validPayload(), user: companyAdmin(), dependencies }),
    (error) => error.statusCode === 409 && /work email/.test(error.message)
  );
});

test("duplicate company Employee ID is rejected", async () => {
  const duplicate = {
    _id: "other",
    companyId: "company-a",
    email: "other@company.test",
    employeeId: "FIN-HOD-001",
    status: "active",
  };
  const { dependencies } = makeHarness({ users: [duplicate] });
  await assert.rejects(
    createDepartmentHod({ departmentId: "department-finance", payload: validPayload(), user: companyAdmin(), dependencies }),
    (error) => error.statusCode === 409 && /Employee ID/.test(error.message)
  );
});

test("credentials are hashed, omitted from response, and excluded from audit", async () => {
  const { state, dependencies } = makeHarness();
  const result = await createDepartmentHod({
    departmentId: "department-finance",
    payload: validPayload(),
    user: companyAdmin(),
    dependencies,
  });
  assert.equal(state.createdPayloads[0].passwordHash, "HASHED:temporary123");
  assert.equal(Object.hasOwn(result.hod, "passwordHash"), false);
  assert.equal(JSON.stringify(state.audits).includes("temporary123"), false);
  assert.equal(JSON.stringify(state.audits).includes("HASHED:"), false);
});

test("audit participates in transaction and cache invalidates only after commit", async () => {
  const { state, dependencies } = makeHarness();
  await createDepartmentHod({
    departmentId: "department-finance",
    payload: validPayload(),
    user: companyAdmin(),
    dependencies,
  });
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].action, "department_hod.setup");
  assert.ok(state.audits[0].session);
  assert.deepEqual(state.cacheInvalidations, ["company-a"]);
});

test("two simultaneous setup calls create exactly one HOD", async () => {
  const { state, dependencies } = makeHarness();
  const calls = [1, 2].map(() =>
    createDepartmentHod({
      departmentId: "department-finance",
      payload: validPayload(),
      user: companyAdmin(),
      dependencies,
    })
  );
  const outcomes = await Promise.allSettled(calls);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal(state.createdPayloads.length, 1);
  assert.match(outcomes.find((item) => item.status === "rejected").reason.message, /already configured/);
});

test("status listing includes HR delegation and summary counts", async () => {
  const finance = makeDepartment();
  const { dependencies } = makeHarness({ department: finance });
  const result = await listDepartmentHodStatuses({ user: companyAdmin(), dependencies });
  assert.equal(result.totalDepartments, 1);
  assert.equal(result.setupRequiredCount, 1);
  assert.equal(result.departments[0].status, "setup_required");
  assert.equal(result.departments[0].setupFlow, "generic");
  assert.equal(result.departments[0].canSetup, true);

  const hr = makeDepartment({ name: "Human Resource", normalizedName: "human resource", slug: "human-resource" });
  const hrHarness = makeHarness({ department: hr });
  const hrResult = await listDepartmentHodStatuses({ user: companyAdmin(), dependencies: hrHarness.dependencies });
  assert.equal(hrResult.departments[0].setupFlow, "existing_hr_setup");
  assert.equal(hrResult.departments[0].canSetup, false);
});
