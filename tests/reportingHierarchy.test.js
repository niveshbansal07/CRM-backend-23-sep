const test = require("node:test");
const assert = require("node:assert/strict");

const User = require("../src/models/User");
const Designation = require("../src/models/Designation");
const {
  getAllowedManagersForEmployee,
  validateReportingManagerAssignment,
} = require("../src/services/reporting.service");

const objectId = (suffix) => `64b64c0000000000000000${String(suffix).padStart(2, "0")}`;
const companyA = objectId(1);
const companyB = objectId(2);
const salesDepartment = objectId(3);
const financeDepartment = objectId(4);

const makeDesignation = ({ id, departmentId = salesDepartment, level }) => ({
  _id: id,
  departmentId,
  name: `Level ${level}`,
  title: `Level ${level}`,
  hierarchyLevel: level,
  status: "active",
  isArchived: false,
  deletedAt: null,
});

const makeCandidate = ({
  id,
  level,
  departmentId = salesDepartment,
  role = "employee",
  status = "active",
}) => ({
  _id: id,
  fullName: `Candidate L${level}`,
  email: `candidate-l${level}-${id.slice(-2)}@example.test`,
  role,
  systemRole: role,
  companyId: companyA,
  departmentId: { _id: departmentId, name: departmentId === salesDepartment ? "Sales" : "Finance" },
  designationId: makeDesignation({ id: objectId(30 + level), departmentId, level }),
  employeeId: `EMP-L${level}`,
  status,
  deletedAt: null,
});

const makeFindChain = (result) => ({
  select() {
    return this;
  },
  populate() {
    return this;
  },
  sort() {
    return Promise.resolve(result);
  },
  then(resolve, reject) {
    return Promise.resolve(result).then(resolve, reject);
  },
});

const withModelStubs = async ({ employeeDesignation, candidates, manager }, callback) => {
  const originalDesignationFindOne = Designation.findOne;
  const originalUserFind = User.find;
  const originalUserFindOne = User.findOne;
  const captured = { designationQueries: [], userQueries: [], managerQueries: [] };

  Designation.findOne = async (query) => {
    captured.designationQueries.push(query);
    return employeeDesignation;
  };
  User.find = (query) => {
    captured.userQueries.push(query);
    return makeFindChain(candidates || []);
  };
  User.findOne = (query) => {
    captured.managerQueries.push(query);
    return makeFindChain(manager || null);
  };

  try {
    return await callback(captured);
  } finally {
    Designation.findOne = originalDesignationFindOne;
    User.find = originalUserFind;
    User.findOne = originalUserFindOne;
  }
};

const loadManagers = async ({ employeeLevel, candidates, departmentId = salesDepartment }) => {
  const employeeDesignation = makeDesignation({
    id: objectId(10 + employeeLevel),
    departmentId,
    level: employeeLevel,
  });

  return withModelStubs({ employeeDesignation, candidates }, (captured) =>
    getAllowedManagersForEmployee({
      companyId: companyA,
      departmentId,
      designationId: employeeDesignation._id,
      actorUser: { role: "hr_executive", companyId: companyA },
    }).then((managers) => ({ managers, captured }))
  );
};

test("L5 Sales Manager includes active L6 Sales HOD regardless of sales_head technical role", async () => {
  const hod = makeCandidate({ id: objectId(51), level: 6, role: "sales_head" });
  const peer = makeCandidate({ id: objectId(52), level: 5, role: "sales_manager" });
  const lower = makeCandidate({ id: objectId(53), level: 4, role: "team_lead" });
  const { managers, captured } = await loadManagers({
    employeeLevel: 5,
    candidates: [hod, peer, lower],
  });

  assert.deepEqual(managers.map((manager) => String(manager._id)), [String(hod._id)]);
  assert.equal(managers[0].role, "sales_head");
  assert.equal(captured.userQueries[0].companyId, companyA);
  assert.equal(captured.userQueries[0].departmentId, salesDepartment);
  assert.equal(captured.userQueries[0].status, "active");
  assert.equal(captured.userQueries[0].deletedAt, null);
});

test("generic hierarchy returns every higher level and excludes equal or lower levels", async () => {
  const candidates = [1, 2, 3, 4, 5, 6].map((level) =>
    makeCandidate({ id: objectId(60 + level), level })
  );

  const expectations = new Map([
    [1, [6, 5, 4, 3, 2]],
    [2, [6, 5, 4, 3]],
    [3, [6, 5, 4]],
    [4, [6, 5]],
    [5, [6]],
    [6, []],
  ]);

  for (const [employeeLevel, expectedLevels] of expectations) {
    const { managers } = await loadManagers({ employeeLevel, candidates });
    assert.deepEqual(
      managers.map((manager) => manager.hierarchyLevel),
      expectedLevels,
      `unexpected manager levels for L${employeeLevel}`
    );
  }
});

test("same-department filtering excludes an otherwise senior Finance HOD", async () => {
  const salesManager = makeCandidate({ id: objectId(71), level: 5, role: "sales_manager" });
  const financeHod = makeCandidate({
    id: objectId(72),
    level: 6,
    departmentId: financeDepartment,
    role: "manager",
  });
  const { managers } = await loadManagers({
    employeeLevel: 3,
    candidates: [salesManager, financeHod],
  });

  assert.deepEqual(managers.map((manager) => String(manager._id)), [String(salesManager._id)]);
});

test("tenant, active, and non-deleted manager constraints remain in the database query", async () => {
  const hod = makeCandidate({ id: objectId(81), level: 6, role: "manager" });
  const { captured } = await loadManagers({ employeeLevel: 3, candidates: [hod] });
  const query = captured.userQueries[0];

  assert.equal(query.companyId, companyA);
  assert.notEqual(query.companyId, companyB);
  assert.equal(query.departmentId, salesDepartment);
  assert.equal(query.status, "active");
  assert.equal(query.deletedAt, null);
  assert.deepEqual(query.designationId, { $ne: null });
});

test("final assignment validation accepts and persists the same higher-level Sales HOD id", async () => {
  const employeeDesignation = makeDesignation({ id: objectId(91), level: 5 });
  const hod = makeCandidate({ id: objectId(92), level: 6, role: "sales_head" });

  const result = await withModelStubs(
    { employeeDesignation, manager: hod },
    (captured) =>
      validateReportingManagerAssignment({
        companyId: companyA,
        employeeDesignationId: employeeDesignation._id,
        departmentId: salesDepartment,
        reportingManagerId: hod._id,
        actorUser: { role: "hr_executive", companyId: companyA },
        employeeRole: "sales_manager",
      }).then((assignment) => ({ assignment, captured }))
  );

  assert.equal(String(result.assignment.reportingManagerId), String(hod._id));
  assert.equal(result.assignment.manager.role, "sales_head");
  assert.equal(result.assignment.overrideUsed, false);
  assert.equal(result.captured.managerQueries[0].companyId, companyA);
  assert.equal(result.captured.managerQueries[0].status, "active");
  assert.equal(result.captured.managerQueries[0].deletedAt, null);
});
