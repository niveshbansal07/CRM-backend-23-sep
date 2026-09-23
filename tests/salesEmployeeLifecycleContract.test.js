const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const User = require("../src/models/User");
const SalesEmployeeLifecycleEvent = require("../src/models/SalesEmployeeLifecycleEvent");
const {
  validateTransferPayload,
  validateOffboarding,
} = require("../src/validators/salesEmployeeLifecycle.validator");

const oid = (suffix) => `85d65d0000000000000000${String(suffix).padStart(2, "0")}`;

const runValidator = (validator, body) => {
  const req = { body };
  let response = null;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { response = { statusCode: this.statusCode, payload }; return this; },
  };
  let nextCalled = false;
  validator(req, res, () => { nextCalled = true; });
  return { req, response, nextCalled };
};

test("transfer validator accepts only explicit employee, destination, manager, reason, and replacement decisions", () => {
  const valid = runValidator(validateTransferPayload, {
    employeeId: oid(1),
    targetGeographyId: oid(2),
    proposedReportingManagerId: oid(3),
    reason: "Territory move",
    replaceCurrentHolder: true,
  });
  assert.equal(valid.nextCalled, true);
  assert.deepEqual(Object.keys(valid.req.validatedBody), [
    "employeeId", "targetGeographyId", "proposedReportingManagerId", "reason", "replaceCurrentHolder",
  ]);
  for (const field of ["companyId", "oldGeographyId", "oldManagerId", "hierarchyLevel", "technicalRole", "effectiveAt"]) {
    const blocked = runValidator(validateTransferPayload, {
      employeeId: oid(1), targetGeographyId: oid(2), reason: "Move", [field]: "client-value",
    });
    assert.equal(blocked.response.statusCode, 400);
  }
});

test("offboarding validator distinguishes temporary suspension from permanent disabled/deleted status", () => {
  const suspended = runValidator(validateOffboarding, { targetStatus: "suspended", reason: "" });
  assert.equal(suspended.nextCalled, true);
  for (const targetStatus of ["disabled", "deleted"]) {
    const missingReason = runValidator(validateOffboarding, { targetStatus, reason: "" });
    assert.equal(missingReason.response.statusCode, 400);
    const valid = runValidator(validateOffboarding, { targetStatus, reason: "Employment ended" });
    assert.equal(valid.nextCalled, true);
  }
});

test("Sales lifecycle history is separate while User remains free of Geography and previous-manager storage", () => {
  assert.ok(SalesEmployeeLifecycleEvent.schema.path("operationId"));
  assert.ok(SalesEmployeeLifecycleEvent.schema.path("oldReportingManagerId"));
  assert.ok(SalesEmployeeLifecycleEvent.schema.path("newReportingManagerId"));
  assert.ok(SalesEmployeeLifecycleEvent.schema.path("oldGeographyAssignmentId"));
  for (const field of ["zoneId", "regionId", "branchId", "areaId", "previousManager1", "previousManager2"]) {
    assert.equal(User.schema.path(field), undefined);
  }
});

test("generic User status and deletion paths invoke only the narrow Sales offboarding hook", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "controllers", "user.controller.js"), "utf8");
  const updateController = controller.slice(
    controller.indexOf("const updateUserController"),
    controller.indexOf("const deleteUserController")
  );
  assert.match(controller, /processSalesEmployeeOffboarding/);
  assert.match(updateController, /const previousStatus = user\.status;/);
  assert.ok(
    updateController.indexOf("const previousStatus = user.status;") <
      updateController.indexOf("processSalesEmployeeOffboarding({")
  );
  assert.match(controller, /targetStatus: "deleted"/);
  assert.doesNotMatch(controller, /Account\.update|Lead\.update|Visit\.update|Order\.update|Distributor/);
});

test("Phase 3B2 lifecycle service contains no historical CRM ownership rewrite", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "services", "salesEmployeeLifecycle.service.js"), "utf8");
  assert.doesNotMatch(service, /require\("\.\.\/models\/(Account|Lead|Visit|Order|Distributor)/);
  assert.doesNotMatch(service, /assignedTo\s*=/);
  assert.doesNotMatch(service, /target allocation|target recalculation/i);
});
