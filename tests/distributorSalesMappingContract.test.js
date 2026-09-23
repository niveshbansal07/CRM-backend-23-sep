const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Account = require("../src/models/Account");
const CompanySequence = require("../src/models/CompanySequence");
const DistributorSalesAssignment = require("../src/models/DistributorSalesAssignment");
const { validateInitialMapping } = require("../src/validators/distributorSalesMapping.validator");

const runValidator = (body) => new Promise((resolve) => {
  const req = { body };
  validateInitialMapping(req, {}, (error) => resolve({ error, body: req.body }));
});

test("Phase 4A schemas add only the minimum Account gaps and a history-capable mapping", () => {
  for (const field of ["distributorBusinessId", "paymentTerms", "appointmentDate"]) {
    assert.ok(Account.schema.path(field));
  }
  for (const forbidden of ["zoneId", "regionId", "branchId", "areaId", "primaryFsdId", "asmId", "zsmId"]) {
    assert.equal(Account.schema.path(forbidden), undefined);
  }
  assert.ok(CompanySequence.schema.indexes().some(([fields, options]) => fields.companyId === 1 && fields.key === 1 && options.unique));
  assert.ok(DistributorSalesAssignment.schema.path("effectiveFrom"));
  assert.ok(DistributorSalesAssignment.schema.path("effectiveTo"));
  assert.ok(DistributorSalesAssignment.schema.indexes().some(([, options]) => options.name === "uniq_current_distributor_sales_mapping"));
});

test("mapping payload accepts only explicit initial Area, FSD, activation, and reason decisions", async () => {
  const valid = await runValidator({
    accountId: "86d65d000000000000000040",
    areaId: "86d65d000000000000000023",
    primaryFsdId: "86d65d000000000000000035",
    reason: "Initial assignment",
    activateAfterMapping: true,
  });
  assert.equal(valid.error, undefined);
  for (const forbidden of ["companyId", "zoneId", "branchId", "oldFsdId", "effectiveFrom", "operationId", "reassign"]) {
    const result = await runValidator({
      accountId: "86d65d000000000000000040",
      areaId: "86d65d000000000000000023",
      primaryFsdId: "86d65d000000000000000035",
      reason: "Initial assignment",
      [forbidden]: "crafted",
    });
    assert.match(result.error.message, /Unsupported Distributor mapping fields/);
  }
});

test("Phase 4A has no replacement Distributor model, reassignment route, or historical CRM mutation", () => {
  const root = path.join(__dirname, "..", "src");
  assert.equal(fs.existsSync(path.join(root, "models", "Distributor.js")), false);
  const routes = fs.readFileSync(path.join(root, "routes", "distributorSalesMapping.routes.js"), "utf8");
  const service = fs.readFileSync(path.join(root, "services", "distributorSalesMapping.service.js"), "utf8");
  assert.doesNotMatch(routes, /reassign|transfer/i);
  assert.doesNotMatch(service, /require\("\.\.\/models\/(Lead|Visit|Order|ActivityLog|Dealer)/);
  assert.doesNotMatch(service, /parentAccountId\s*=/);
});

test("generic Account create, update, and assign paths contain narrow Distributor guards", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "services", "account.service.js"), "utf8");
  assert.match(source, /allocateDistributorBusinessId/);
  assert.match(source, /assertDistributorAccountMutationAllowed/);
  assert.match(source, /Distributor must be mapped to an Area and Primary FSD before activation/);
  assert.match(source, /distributorBusinessId/);
});
