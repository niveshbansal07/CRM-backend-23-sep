const test = require("node:test");
const assert = require("node:assert/strict");
const {
  EMPLOYEE_ACCOUNT_ROLES,
  resolveEmployeeSystemRole,
  resolveEmployeeRoleV2,
  validateRoleAssignment,
} = require("../src/utils/employeeRole");
const {
  validateStatusTransition,
  resolveRequestedRole,
  resolveRequestedOrgDetails,
  findRequestApprover,
  assertAssignedApprover,
  assertRequestSetupOwner,
  assertInitialHodRequestPolicy,
  resolveEmployeeRequestApproverId,
} = require("../src/services/employeeRequest.service");

test("employee self-service roles include Sales leadership and representatives", () => {
  assert.equal(EMPLOYEE_ACCOUNT_ROLES.includes("sales_head"), true);
  assert.equal(EMPLOYEE_ACCOUNT_ROLES.includes("sales_manager"), true);
  assert.equal(EMPLOYEE_ACCOUNT_ROLES.includes("sales_executive"), true);
});

test("assigns Sales Head role from a structured head designation", () => {
  assert.equal(
    resolveEmployeeSystemRole({
      requestedRole: "employee",
      departmentName: "Sales",
      designation: { title: "Head of Sales", hierarchyLevel: 6 },
      isDepartmentHead: true,
    }),
    "sales_head"
  );
});

test("does not downgrade Sales Head request to Sales Manager", () => {
  assert.equal(
    resolveEmployeeSystemRole({
      requestedRole: "sales_manager",
      departmentName: "Sales",
      designation: { title: "Sales Head", hierarchyLevel: 6 },
      isDepartmentHead: true,
    }),
    "sales_head"
  );
});

test("assigns Sales Manager below the Sales Head", () => {
  assert.equal(
    resolveEmployeeSystemRole({
      requestedRole: "employee",
      departmentName: "Sales",
      designation: { title: "Sales Manager", hierarchyLevel: 5 },
    }),
    "sales_manager"
  );
});

test("uses an explicit supported designation mapping before title fallback", () => {
  assert.equal(
    resolveEmployeeSystemRole({
      requestedRole: "employee",
      departmentName: "Sales",
      designation: { title: "Regional Lead", mappedRole: "sales_manager" },
    }),
    "sales_manager"
  );
});

test("maps non-sales department heads to the generic manager role", () => {
  assert.equal(
    resolveEmployeeSystemRole({
      requestedRole: "employee",
      departmentName: "Operations",
      designation: { title: "Operations Head" },
      isDepartmentHead: true,
    }),
    "manager"
  );
});

test("V2 assigns HR Head for Human Resource head designation", () => {
  assert.equal(
    resolveEmployeeRoleV2({
      department: { normalizedName: "human_resource", name: "Human Resource" },
      designation: { title: "Head of HR", isHead: true, hierarchyLevel: 6 },
    }),
    "hr_head"
  );
});

test("V2 assigns Sales Manager for senior Sales designation", () => {
  assert.equal(
    resolveEmployeeRoleV2({
      department: { normalizedName: "sales", name: "Sales" },
      designation: { title: "Sales Manager", hierarchyLevel: 5 },
    }),
    "sales_manager"
  );
});

test("V2 keeps Software Developer in IT as employee", () => {
  assert.equal(
    resolveEmployeeRoleV2({
      department: { normalizedName: "it", name: "IT" },
      designation: { title: "Software Developer", hierarchyLevel: 3 },
    }),
    "employee"
  );
});

test("V2 maps Department Head of Finance to manager", () => {
  assert.equal(
    resolveEmployeeRoleV2({
      department: { normalizedName: "finance", name: "Finance" },
      designation: { title: "Head of Finance", isHead: true, hierarchyLevel: 6 },
    }),
    "manager"
  );
});

test("V2 keeps interns in any department as employee", () => {
  assert.equal(
    resolveEmployeeRoleV2({
      department: { normalizedName: "sales", name: "Sales" },
      designation: { title: "Intern", hierarchyLevel: 1 },
    }),
    "employee"
  );
});

test("V2 trusts explicit mappedRole on designation after head checks", () => {
  assert.equal(
    resolveEmployeeRoleV2({
      department: { normalizedName: "sales", name: "Sales" },
      designation: { title: "Field Executive", mappedRole: "sales_executive", hierarchyLevel: 2 },
    }),
    "sales_executive"
  );
});

test("role assignment validation blocks privileged admin roles", () => {
  assert.equal(
    validateRoleAssignment("company_admin", { hierarchyLevel: 6 }, { normalizedName: "sales" }).valid,
    false
  );
  assert.equal(
    validateRoleAssignment("super_admin", { hierarchyLevel: 6 }, { normalizedName: "sales" }).valid,
    false
  );
  assert.equal(
    validateRoleAssignment("sub_admin", { hierarchyLevel: 6 }, { normalizedName: "sales" }).valid,
    false
  );
});

const employeeDepartment = (name, allowedRoles = ["employee"]) => ({
  name,
  normalizedName: name.toLowerCase().replace(/\s+/g, "_"),
  allowedRoles,
});

const assertInitialHodRequestRejected = (department) => {
  assert.throws(
    () => assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: true }),
    (error) =>
      error?.statusCode === 400 &&
      /Initial Department HOD must be configured by Company Admin from HOD Setup/.test(error.message)
  );
};

test("EmployeeRequest rejects a Finance HOD designation", () => {
  assertInitialHodRequestRejected(employeeDepartment("Finance"));
});

test("EmployeeRequest rejects a Sales Head designation", () => {
  assertInitialHodRequestRejected(employeeDepartment("Sales"));
});

test("EmployeeRequest rejects a custom Department HOD designation", () => {
  assertInitialHodRequestRejected(employeeDepartment("Customer Experience"));
});

test("EmployeeRequest continues to accept Sales Manager", () => {
  const department = employeeDepartment("Sales");
  assert.doesNotThrow(() =>
    assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: false })
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "",
      department,
      designation: { title: "Sales Manager", hierarchyLevel: 5 },
    }),
    "sales_manager"
  );
});

test("EmployeeRequest continues to accept Sales Executive", () => {
  const department = employeeDepartment("Sales");
  assert.doesNotThrow(() =>
    assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: false })
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "sales_executive",
      department,
      designation: { title: "Sales Executive", mappedRole: "sales_executive", hierarchyLevel: 2 },
    }),
    "sales_executive"
  );
});

test("EmployeeRequest continues to accept Finance Manager", () => {
  const department = employeeDepartment("Finance");
  assert.doesNotThrow(() =>
    assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: false })
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "manager",
      department,
      designation: { title: "Finance Manager", mappedRole: "manager", hierarchyLevel: 5 },
    }),
    "manager"
  );
});

test("EmployeeRequest continues to accept a generic employee", () => {
  const department = employeeDepartment("IT");
  assert.doesNotThrow(() =>
    assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: false })
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "",
      department,
      designation: { title: "Software Developer", hierarchyLevel: 3 },
    }),
    "employee"
  );
});

test("EmployeeRequest continues to accept HR Manager and HR Executive", () => {
  const department = employeeDepartment("Human Resources");
  assert.doesNotThrow(() =>
    assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: false })
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "hr_manager",
      department,
      designation: { title: "HR Manager", mappedRole: "hr_manager", hierarchyLevel: 5 },
    }),
    "hr_manager"
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "hr_executive",
      department,
      designation: { title: "HR Executive", mappedRole: "hr_executive", hierarchyLevel: 3 },
    }),
    "hr_executive"
  );
});

test("EmployeeRequest policy preserves the Human Resources bootstrap exception", () => {
  for (const department of [
    employeeDepartment("HR"),
    employeeDepartment("Human Resource"),
    employeeDepartment("Human Resources"),
  ]) {
    assert.doesNotThrow(() =>
      assertInitialHodRequestPolicy({ department, isDepartmentHeadRequest: true })
    );
  }
});

test("employee requests keep ordinary employees on the generic role", () => {
  assert.equal(
    resolveRequestedRole({
      requestedRole: "",
      department: employeeDepartment("IT"),
      designation: { title: "Software Developer", hierarchyLevel: 3, allowedRoles: ["employee"] },
    }),
    "employee"
  );
});

test("employee requests accept Sales Executive from designation mapping", () => {
  assert.equal(
    resolveRequestedRole({
      requestedRole: "sales_executive",
      department: employeeDepartment("Sales"),
      designation: { title: "Sales Executive", mappedRole: "sales_executive", hierarchyLevel: 2 },
    }),
    "sales_executive"
  );
});

test("employee requests accept Sales Manager L5 with generic department eligibility", () => {
  assert.equal(
    resolveRequestedRole({
      requestedRole: "",
      department: employeeDepartment("Sales"),
      designation: { title: "Sales Manager - L5", hierarchyLevel: 5, allowedRoles: ["employee"] },
    }),
    "sales_manager"
  );
});

test("employee requests accept the canonical Sales Head role for a Sales HOD", () => {
  assert.equal(
    resolveRequestedRole({
      requestedRole: "",
      department: employeeDepartment("Sales"),
      designation: { title: "Head of Sales", hierarchyLevel: 6, isHead: true, allowedRoles: ["employee"] },
      isDepartmentHead: true,
    }),
    "sales_head"
  );
});

test("employee requests preserve existing HR role resolution", () => {
  assert.equal(
    resolveRequestedRole({
      requestedRole: "hr_manager",
      department: employeeDepartment("Human Resource"),
      designation: { title: "HR Manager", mappedRole: "hr_manager", hierarchyLevel: 5 },
    }),
    "hr_manager"
  );
  assert.equal(
    resolveRequestedRole({
      requestedRole: "hr_executive",
      department: employeeDepartment("Human Resource"),
      designation: { title: "HR Executive", mappedRole: "hr_executive", hierarchyLevel: 3 },
    }),
    "hr_executive"
  );
});

test("employee requests still reject privileged requested roles", () => {
  assert.throws(
    () => resolveRequestedRole({
      requestedRole: "super_admin",
      department: employeeDepartment("Sales"),
      designation: { title: "Sales Manager - L5", hierarchyLevel: 5 },
    }),
    /Company Admin and Super Admin cannot be assigned/
  );
});

test("employee requests reject a Sales role outside the Sales department", () => {
  assert.throws(
    () => resolveRequestedRole({
      requestedRole: "",
      department: employeeDepartment("Finance"),
      designation: { title: "Finance Manager", mappedRole: "sales_manager", hierarchyLevel: 5 },
    }),
    /Sales roles can only be assigned in the Sales department/
  );
});

const queryResult = (value) => {
  const query = Promise.resolve(value);
  query.select = () => query;
  query.populate = () => query;
  query.sort = () => query;
  return query;
};

const assertOrgHeadRequestRejected = async ({ departmentName, designationTitle }) => {
  const department = {
    _id: `department-${departmentName}`,
    companyId: "company-a",
    name: departmentName,
    normalizedName: departmentName.toLowerCase().replace(/\s+/g, "_"),
    status: "active",
    allowedRoles: ["employee"],
  };
  const designation = {
    _id: `designation-${designationTitle}`,
    companyId: "company-a",
    departmentId: department._id,
    name: designationTitle,
    title: designationTitle,
    hierarchyLevel: 6,
    isDepartmentHead: true,
    isHead: true,
    status: "active",
  };

  await assert.rejects(
    resolveRequestedOrgDetails({
      payload: { departmentId: department._id, designationId: designation._id },
      user: { _id: "hr-executive-a", companyId: "company-a", role: "hr_executive" },
      DepartmentModel: { findOne: () => queryResult(department) },
      DesignationModel: { findOne: () => queryResult(designation) },
      hasActiveDepartmentHeadFn: async () => {
        throw new Error("Head prerequisite lookup must not run after the single-source guard rejects");
      },
    }),
    /Initial Department HOD must be configured by Company Admin from HOD Setup/
  );
};

test("EmployeeRequest organization resolution rejects Finance HOD creation", async () => {
  await assertOrgHeadRequestRejected({ departmentName: "Finance", designationTitle: "Head of Finance" });
});

test("EmployeeRequest organization resolution rejects Sales Head creation", async () => {
  await assertOrgHeadRequestRejected({ departmentName: "Sales", designationTitle: "Head of Sales" });
});

test("EmployeeRequest organization resolution rejects custom Department HOD creation", async () => {
  await assertOrgHeadRequestRejected({
    departmentName: "Customer Experience",
    designationTitle: "Head of Customer Experience",
  });
});

test("EmployeeRequest organization resolution accepts Sales Manager after HOD bootstrap", async () => {
  const department = {
    _id: "department-sales",
    companyId: "company-a",
    name: "Sales",
    normalizedName: "sales",
    status: "active",
    allowedRoles: ["employee"],
  };
  const designation = {
    _id: "designation-sales-manager",
    companyId: "company-a",
    departmentId: department._id,
    name: "Sales Manager",
    title: "Sales Manager",
    hierarchyLevel: 5,
    status: "active",
  };

  const details = await resolveRequestedOrgDetails({
    payload: { departmentId: department._id, designationId: designation._id },
    user: { _id: "hr-executive-a", companyId: "company-a", role: "hr_executive" },
    DepartmentModel: { findOne: () => queryResult(department) },
    DesignationModel: { findOne: () => queryResult(designation) },
    isDepartmentHeadDesignationFn: async () => false,
    hasActiveDepartmentHeadFn: async () => true,
  });

  assert.equal(details.requestedRole, "sales_manager");
  assert.equal(details.requestType, "employee_create");
});

test("normal EmployeeRequest still requires the initial Department HOD", async () => {
  const department = {
    _id: "department-finance",
    companyId: "company-a",
    name: "Finance",
    normalizedName: "finance",
    status: "active",
    allowedRoles: ["employee"],
  };
  const designation = {
    _id: "designation-finance-executive",
    companyId: "company-a",
    departmentId: department._id,
    name: "Finance Executive",
    title: "Finance Executive",
    hierarchyLevel: 2,
    status: "active",
  };

  await assert.rejects(
    resolveRequestedOrgDetails({
      payload: { departmentId: department._id, designationId: designation._id },
      user: { _id: "hr-executive-a", companyId: "company-a", role: "hr_executive" },
      DepartmentModel: { findOne: () => queryResult(department) },
      DesignationModel: { findOne: () => queryResult(designation) },
      isDepartmentHeadDesignationFn: async () => false,
      hasActiveDepartmentHeadFn: async () => false,
    }),
    /Please create Head of Finance before requesting other Finance employees/
  );
});

test("EmployeeRequest organization resolution preserves tenant-scoped Department lookup", async () => {
  let departmentQuery = null;
  await assert.rejects(
    resolveRequestedOrgDetails({
      payload: { departmentId: "department-from-company-b", designationId: "designation-b" },
      user: { _id: "hr-executive-a", companyId: "company-a", role: "hr_executive" },
      DepartmentModel: {
        findOne: (query) => {
          departmentQuery = query;
          return queryResult(null);
        },
      },
      DesignationModel: { findOne: () => queryResult(null) },
    }),
    /Active department not found/
  );
  assert.equal(departmentQuery.companyId, "company-a");
});

test("employee requests route approval to the requester's active direct manager", async () => {
  let searchedFallback = false;
  const manager = {
    _id: "manager-a",
    systemRole: "hr_manager",
    designationId: { hierarchyLevel: 5 },
  };
  const UserModel = {
    findById: () => queryResult({
      _id: "requester-a",
      companyId: "company-a",
      reportingManagerId: "manager-a",
    }),
    findOne: (query) => {
      assert.equal(query._id, "manager-a");
      assert.equal(query.companyId, "company-a");
      assert.equal(query.status, "active");
      assert.equal(query.deletedAt, null);
      return queryResult(manager);
    },
    find: () => {
      searchedFallback = true;
      return queryResult([]);
    },
  };

  const result = await findRequestApprover({
    user: { _id: "requester-a", companyId: "company-a" },
    UserModel,
    CompanyModel: {},
  });

  assert.equal(result.approver, manager);
  assert.equal(result.approverId, "manager-a");
  assert.equal(result.approverRole, "hr_manager");
  assert.equal(result.approverReason, "Assigned to requester reporting manager");
  assert.equal(searchedFallback, false, "HR Head fallback must not run when the direct manager is valid");
});

test("employee requests do not select a direct manager from another company", async () => {
  let managerQuery = null;
  const hrHead = {
    _id: "head-a",
    systemRole: "hr_head",
    designationId: { hierarchyLevel: 6 },
  };
  const UserModel = {
    findById: () => queryResult({
      _id: "requester-a",
      companyId: "company-a",
      reportingManagerId: "manager-from-company-b",
    }),
    findOne: (query) => {
      managerQuery = query;
      return queryResult(null);
    },
    find: (query) => {
      assert.equal(query.companyId, "company-a");
      return queryResult([hrHead]);
    },
  };

  const result = await findRequestApprover({
    user: { _id: "requester-a", companyId: "company-a" },
    UserModel,
    CompanyModel: {},
  });

  assert.equal(managerQuery.companyId, "company-a");
  assert.equal(result.approver, hrHead);
  assert.equal(result.approverId, "head-a");
  assert.match(result.approverReason, /HR Head fallback/);
});

test("employee requests use the existing fallback when the direct manager is inactive", async () => {
  const hrHead = { _id: "head-a", systemRole: "hr_head" };
  const UserModel = {
    findById: () => queryResult({
      _id: "requester-a",
      companyId: "company-a",
      reportingManagerId: "inactive-manager-a",
    }),
    findOne: (query) => {
      assert.equal(query._id, "inactive-manager-a");
      assert.equal(query.companyId, "company-a");
      assert.equal(query.status, "active");
      assert.equal(query.deletedAt, null);
      return queryResult(null);
    },
    find: () => queryResult([hrHead]),
  };

  const result = await findRequestApprover({
    user: { _id: "requester-a", companyId: "company-a" },
    UserModel,
    CompanyModel: {},
  });

  assert.equal(result.approverId, "head-a");
  assert.match(result.approverReason, /HR Head fallback/);
});

test("employee requests use the existing HR Head fallback when no direct manager exists", async () => {
  const hrHead = { _id: "head-a", systemRole: "hr_head" };
  const UserModel = {
    findById: () => queryResult({ _id: "requester-a", companyId: "company-a" }),
    find: () => queryResult([hrHead]),
  };

  const result = await findRequestApprover({
    user: { _id: "requester-a", companyId: "company-a" },
    UserModel,
    CompanyModel: {},
  });

  assert.equal(result.approver, hrHead);
  assert.equal(result.approverId, "head-a");
  assert.equal(result.approverRole, "hr_head");
});

test("employee requests fall back when the direct manager cannot review HR requests", async () => {
  const nonReviewer = { _id: "manager-a", systemRole: "sales_manager" };
  const hrHead = { _id: "head-a", systemRole: "hr_head" };
  const UserModel = {
    findById: () => queryResult({
      _id: "requester-a",
      companyId: "company-a",
      reportingManagerId: "manager-a",
    }),
    findOne: () => queryResult(nonReviewer),
    find: () => queryResult([hrHead]),
  };

  const result = await findRequestApprover({
    user: { _id: "requester-a", companyId: "company-a" },
    UserModel,
    CompanyModel: {},
  });

  assert.equal(result.approver, hrHead);
  assert.equal(result.approverId, "head-a");
  assert.match(result.approverReason, /HR Head fallback/);
});

test("employee request persistence and notification resolve the same approver id", () => {
  const manager = { _id: "manager-a", systemRole: "hr_manager" };
  assert.equal(
    resolveEmployeeRequestApproverId({ approver: manager, approverId: manager._id }),
    "manager-a"
  );
  assert.equal(resolveEmployeeRequestApproverId({ approver: manager }), "manager-a");
  assert.throws(
    () => resolveEmployeeRequestApproverId({}),
    /No approver is available/
  );
});

test("only the assigned manager can review an employee request", () => {
  const request = { assignedTo: "manager-a" };
  assert.doesNotThrow(() => assertAssignedApprover(request, { _id: "manager-a", role: "hr_manager" }));
  assert.throws(
    () => assertAssignedApprover(request, { _id: "manager-b", role: "hr_manager" }),
    /assigned to another approver/
  );
});

test("only the authorized request creator owns employee setup", () => {
  const request = { requestedBy: "requester-a", status: "setup_pending" };
  assert.doesNotThrow(() => assertRequestSetupOwner(request, { _id: "requester-a", role: "hr_executive" }));
  assert.throws(
    () => assertRequestSetupOwner(request, { _id: "requester-b", role: "hr_executive" }),
    /Only the request creator/
  );
  assert.throws(
    () => assertRequestSetupOwner(request, { _id: "head-a", role: "hr_head" }),
    /Only the request creator/
  );
});

test("employee request status transitions reject invalid jumps", () => {
  assert.equal(validateStatusTransition("pending", "approved"), true);
  assert.throws(
    () => validateStatusTransition("pending", "completed"),
    /Invalid status transition from pending to completed/
  );
  assert.throws(
    () => validateStatusTransition("completed", "declined"),
    /Invalid status transition from completed to declined/
  );
});
