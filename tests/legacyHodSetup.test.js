const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createUserForApprovedEmployeeRequest,
} = require("../src/controllers/user.controller");

const makePayload = (overrides = {}) => ({
  companyId: "company-a",
  departmentId: "department-finance",
  designationId: "designation-finance-head",
  fullName: "Legacy Candidate",
  email: "legacy@example.test",
  passwordHash: "hashed-password",
  role: "manager",
  systemRole: "manager",
  status: "active",
  ...overrides,
});

const makeUserModel = () => {
  const created = [];
  return {
    created,
    model: {
      create: async (payload) => {
        const user = { _id: `user-${created.length + 1}`, ...payload };
        created.push(user);
        return user;
      },
    },
  };
};

test("historical Finance HOD setup remains allowed when no active HOD exists", async () => {
  const users = makeUserModel();
  const user = await createUserForApprovedEmployeeRequest({
    isHeadSetup: true,
    companyId: "company-a",
    departmentId: "department-finance",
    userPayload: makePayload(),
    findActiveDepartmentHeadFn: async () => null,
    UserModel: users.model,
  });

  assert.equal(user.role, "manager");
  assert.equal(users.created.length, 1);
});

test("historical Finance HOD setup is rejected when HOD Setup already created an active HOD", async () => {
  const users = makeUserModel();

  await assert.rejects(
    createUserForApprovedEmployeeRequest({
      isHeadSetup: true,
      companyId: "company-a",
      departmentId: "department-finance",
      userPayload: makePayload(),
      findActiveDepartmentHeadFn: async () => ({ _id: "active-finance-hod" }),
      UserModel: users.model,
    }),
    (error) =>
      error?.statusCode === 409 &&
      /already has an active HOD/.test(error.message)
  );

  assert.equal(users.created.length, 0, "a second Finance HOD must not be created");
});

test("historical Sales Head setup is rejected when a Sales Head is active", async () => {
  const users = makeUserModel();

  await assert.rejects(
    createUserForApprovedEmployeeRequest({
      isHeadSetup: true,
      companyId: "company-a",
      departmentId: "department-sales",
      userPayload: makePayload({
        departmentId: "department-sales",
        designationId: "designation-sales-head",
        role: "sales_head",
        systemRole: "sales_head",
      }),
      findActiveDepartmentHeadFn: async () => ({ _id: "active-sales-head" }),
      UserModel: users.model,
    }),
    /already has an active HOD/
  );

  assert.equal(users.created.length, 0, "a second Sales Head must not be created");
});

const assertNormalSetupUnchanged = async (role, designationId) => {
  const users = makeUserModel();
  let headLookupCalled = false;
  const user = await createUserForApprovedEmployeeRequest({
    isHeadSetup: false,
    companyId: "company-a",
    departmentId: "department-a",
    userPayload: makePayload({ role, systemRole: role, designationId }),
    findActiveDepartmentHeadFn: async () => {
      headLookupCalled = true;
      return { _id: "irrelevant-head" };
    },
    UserModel: users.model,
  });

  assert.equal(user.role, role);
  assert.equal(users.created.length, 1);
  assert.equal(headLookupCalled, false, "normal setup must not receive the legacy HOD recheck");
};

test("normal Sales Manager setup remains unchanged", async () => {
  await assertNormalSetupUnchanged("sales_manager", "designation-sales-manager");
});

test("normal Sales Executive setup remains unchanged", async () => {
  await assertNormalSetupUnchanged("sales_executive", "designation-sales-executive");
});

test("normal generic employee setup remains unchanged", async () => {
  await assertNormalSetupUnchanged("employee", "designation-software-developer");
});

test("HR Manager and HR Executive setup remain unchanged", async () => {
  await assertNormalSetupUnchanged("hr_manager", "designation-hr-manager");
  await assertNormalSetupUnchanged("hr_executive", "designation-hr-executive");
});

test("legacy HOD recheck is scoped to the request company and Department", async () => {
  const users = makeUserModel();
  let lookup = null;

  await createUserForApprovedEmployeeRequest({
    isHeadSetup: true,
    companyId: "company-a",
    departmentId: "department-finance-a",
    userPayload: makePayload({ departmentId: "department-finance-a" }),
    findActiveDepartmentHeadFn: async (query) => {
      lookup = query;
      return null;
    },
    UserModel: users.model,
  });

  assert.deepEqual(lookup, {
    companyId: "company-a",
    departmentId: "department-finance-a",
  });
  assert.equal(users.created.length, 1, "another company's HOD must not block this request");
});
