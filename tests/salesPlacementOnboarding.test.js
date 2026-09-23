const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const User = require("../src/models/User");
const EmployeeRequest = require("../src/models/EmployeeRequest");
const { evaluateSalesPlacementAfterOnboarding } = require("../src/services/salesPlacement.service");

test("non-Sales onboarding returns not applicable without calling Phase 3A assignment readiness", async () => {
  let evaluationCalls = 0;
  const result = await evaluateSalesPlacementAfterOnboarding({
    employee: { _id: "employee-1", role: "employee" },
    department: { name: "Finance", code: "FIN" },
    companyId: "company-1",
    dependencies: {
      evaluateSalesPlacement: async () => {
        evaluationCalls += 1;
        throw new Error("must not run");
      },
    },
  });
  assert.equal(evaluationCalls, 0);
  assert.equal(result.salesPlacement.applicable, false);
  assert.equal(result.warning, null);
});

test("Sales onboarding delegates its read model to the Phase 3A placement evaluator", async () => {
  const expected = {
    applicable: true,
    hierarchyLevel: 1,
    technicalRole: "sales_executive",
    geographyType: "AREA",
    status: "UNASSIGNED",
    currentGeography: null,
  };
  let received = null;
  const result = await evaluateSalesPlacementAfterOnboarding({
    employee: { _id: "employee-2", role: "sales_executive" },
    department: { name: "Sales", code: "SALES" },
    companyId: "company-1",
    dependencies: {
      evaluateSalesPlacement: async (input) => {
        received = input;
        return expected;
      },
    },
  });
  assert.equal(received.employeeId, "employee-2");
  assert.equal(received.companyId, "company-1");
  assert.deepEqual(result.salesPlacement, expected);
  assert.equal(result.warning, null);
});

test("optional Sales placement evaluation failure cannot undo successful employee setup", async () => {
  const warnings = [];
  const result = await evaluateSalesPlacementAfterOnboarding({
    employee: { _id: "employee-3", role: "sales_manager" },
    department: { name: "Sales" },
    companyId: "company-1",
    dependencies: {
      evaluateSalesPlacement: async () => { throw new Error("temporary read failure"); },
      logger: { warn: (...args) => warnings.push(args) },
    },
  });
  assert.equal(result.salesPlacement, null);
  assert.match(result.warning, /Employee created successfully/);
  assert.equal(warnings.length, 1);
});

test("onboarding integration adds no Geography storage to User or EmployeeRequest", () => {
  for (const field of ["zoneId", "regionId", "branchId", "areaId", "zone", "region", "branch", "area"]) {
    assert.equal(User.schema.path(field), undefined);
    assert.equal(EmployeeRequest.schema.path(field), undefined);
  }
});

test("employee setup response invokes a read-only placement hook and no assignment write", () => {
  const controllerPath = path.join(__dirname, "..", "src", "controllers", "user.controller.js");
  const source = fs.readFileSync(controllerPath, "utf8");
  assert.match(source, /evaluateSalesPlacementAfterOnboarding/);
  assert.match(source, /salesPlacementWarning/);
  assert.doesNotMatch(source, /assignSalesGeography/);
});
