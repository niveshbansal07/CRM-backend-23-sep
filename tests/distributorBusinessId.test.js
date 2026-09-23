const test = require("node:test");
const assert = require("node:assert/strict");

const { allocateDistributorBusinessId } = require("../src/services/distributorAccount.service");

const companyId = "86d65d000000000000000001";

test("Distributor business IDs use a company-scoped atomic sequence rather than document counts", async () => {
  let value = 0;
  const calls = [];
  const SequenceModel = {
    async findOneAndUpdate(filter, update, options) {
      calls.push({ filter, update, options });
      await Promise.resolve();
      value += 1;
      return { value };
    },
  };
  const ids = await Promise.all([
    allocateDistributorBusinessId({ companyId, SequenceModel }),
    allocateDistributorBusinessId({ companyId, SequenceModel }),
    allocateDistributorBusinessId({ companyId, SequenceModel }),
  ]);
  assert.deepEqual(ids, ["DIST-000001", "DIST-000002", "DIST-000003"]);
  assert.equal(new Set(ids).size, 3);
  assert.ok(calls.every((call) => call.filter.companyId === companyId));
  assert.ok(calls.every((call) => call.update.$inc.value === 1));
  assert.ok(calls.every((call) => call.options.upsert === true && call.options.new === true));
});

test("sequence allocation safely retries a concurrent first-upsert duplicate", async () => {
  let attempt = 0;
  const SequenceModel = {
    async findOneAndUpdate() {
      attempt += 1;
      if (attempt === 1) throw Object.assign(new Error("duplicate"), { code: 11000 });
      return { value: 8 };
    },
  };
  assert.equal(
    await allocateDistributorBusinessId({ companyId, SequenceModel }),
    "DIST-000008"
  );
  assert.equal(attempt, 2);
});
