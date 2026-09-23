const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const {
  validateInitialParent,
  assertNoParentCycle,
  assertChannelParentMutationAllowed,
  deriveChannelHierarchy,
  buildChannelMappingPreview,
  applyChannelMapping,
  listChannelReadiness,
} = require("../src/services/channelMapping.service");

const oid = (n) => new mongoose.Types.ObjectId(n.toString(16).padStart(24, "0"));
const id = (value) => String(value?._id || value?.id || value || "");
const companyId = oid(1);
const otherCompanyId = oid(2);
const typeMaster = (n, code) => ({ _id: oid(n), companyId, module: "account", type: "account_type", code, name: code, isActive: true });
const types = {
  DISTRIBUTOR: typeMaster(10, "DISTRIBUTOR"), DEALER: typeMaster(11, "DEALER"),
  RETAILER: typeMaster(12, "RETAILER"), CUSTOMER: typeMaster(13, "CUSTOMER"),
};
const makeAccount = (n, name, type, values = {}) => ({
  _id: oid(n), companyId, name, status: "active", accountTypeId: types[type], accountType: type.toLowerCase(),
  parentAccountId: null, parentRelationshipType: null, assignedTo: oid(90), deletedAt: null, ...values,
  async save() { this.saveCount = (this.saveCount || 0) + 1; return this; },
  toObject() { return { ...this }; },
});

const matches = (record, filter = {}) => Object.entries(filter).every(([key, expected]) => {
  const actual = record[key];
  if (expected && typeof expected === "object" && "$in" in expected) return expected.$in.some((item) => id(item) === id(actual));
  return id(actual) === id(expected);
});
const query = (value) => ({
  populate() { return this; }, session() { return this; }, sort() { return this; }, select() { return this; }, lean() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
const session = () => ({ startTransaction() {}, async commitTransaction() {}, async abortTransaction() {}, async endSession() {} });

const makeFixture = () => {
  const distributor = makeAccount(20, "Mapped Distributor", "DISTRIBUTOR", { distributorBusinessId: "DIST-000001" });
  const legacyDistributor = makeAccount(21, "Legacy Distributor", "DISTRIBUTOR", { distributorBusinessId: "DIST-000002" });
  const dealer = makeAccount(30, "Dealer One", "DEALER", { status: "partner" });
  const retailer = makeAccount(31, "Retailer One", "RETAILER", { status: "partner" });
  const customer = makeAccount(32, "Customer One", "CUSTOMER", { status: "customer" });
  const otherCustomer = makeAccount(33, "Customer Two", "CUSTOMER", { status: "customer" });
  const accounts = [distributor, legacyDistributor, dealer, retailer, customer, otherCustomer];
  const mapping = { _id: oid(40), companyId, distributorAccountId: distributor._id, geographyId: oid(41), primaryFsdId: oid(90), isCurrent: true, deletedAt: null };
  const mappings = [mapping];
  const audits = [];
  const healthByDistributor = new Map([[id(distributor._id), {
    state: "MAPPED_VALID", requiresReassignment: false,
    geography: { zone: { name: "North" }, region: { name: "West" }, branch: { name: "Delhi" }, area: { name: "Area A" } },
    primaryFsd: { id: oid(90), fullName: "Primary FSD" },
    supervisoryOwnership: {
      asm: { fullName: "ASM" }, branchManager: { fullName: "Branch Manager" }, rsm: { fullName: "RSM" },
      zsm: { fullName: "ZSM" }, headOfSales: { fullName: "Head of Sales" },
    }, warnings: [],
  }], [id(legacyDistributor._id), { state: "LEGACY_ACTIVE_UNMAPPED", requiresReassignment: false, warnings: [] }]]);
  const dependencies = {
    Account: {
      findOne: (filter) => query(accounts.find((item) => matches(item, filter)) || null),
      find: (filter) => query(accounts.filter((item) => matches(item, filter))),
    },
    CrmMaster: {
      findOne: (filter) => query(Object.values(types).find((item) => matches(item, filter)) || null),
      find: (filter) => query(Object.values(types).filter((item) => matches(item, filter))),
    },
    DistributorMapping: { findOne: (filter) => query(mappings.find((item) => matches(item, filter)) || null) },
    AuditLog: { find: () => query(audits) },
    getAccountTypeMaster: async ({ accountTypeId }) => typeof accountTypeId === "object"
      ? accountTypeId
      : Object.values(types).find((item) => id(item._id) === id(accountTypeId)) || null,
    loadDistributorAccount: async ({ accountId, companyId: tenant }) => {
      const account = accounts.find((item) => id(item._id) === id(accountId) && id(item.companyId) === id(tenant) && item.accountTypeId.code === "DISTRIBUTOR");
      if (!account) throw Object.assign(new Error("Distributor Account not found"), { statusCode: 404 });
      return account;
    },
    loadCurrentMapping: async ({ accountId }) => mappings.find((item) => id(item.distributorAccountId) === id(accountId) && item.isCurrent) || null,
    evaluateCurrentMapping: async ({ account }) => healthByDistributor.get(id(account._id)),
    writeAuditLog: async (entry) => { audits.push(entry); return entry; },
    startSession: async () => session(), newOperationId: () => oid(60),
  };
  const user = { _id: oid(70), companyId, role: "sales_head", systemRole: "sales_head" };
  return { accounts, distributor, legacyDistributor, dealer, retailer, customer, otherCustomer, mappings, audits, healthByDistributor, dependencies, user };
};

test("canonical parent rules accept Distributor→Dealer/Retailer and Dealer/Retailer→Customer", async () => {
  const f = makeFixture();
  assert.equal((await validateInitialParent({ companyId, accountTypeId: types.DEALER, parentAccountId: f.distributor._id, dependencies: f.dependencies })).parentRelationshipType, "distributor");
  assert.equal((await validateInitialParent({ companyId, accountTypeId: types.RETAILER, parentAccountId: f.distributor._id, dependencies: f.dependencies })).parentRelationshipType, "distributor");
  assert.equal((await validateInitialParent({ companyId, accountTypeId: types.CUSTOMER, parentAccountId: f.dealer._id, dependencies: f.dependencies })).parentRelationshipType, "dealer");
  assert.equal((await validateInitialParent({ companyId, accountTypeId: types.CUSTOMER, parentAccountId: f.retailer._id, dependencies: f.dependencies })).parentRelationshipType, "retailer");
});

test("invalid Dealer, Retailer, and Customer parent combinations are rejected", async () => {
  const f = makeFixture();
  await assert.rejects(validateInitialParent({ companyId, accountTypeId: types.DEALER, parentAccountId: f.customer._id, dependencies: f.dependencies }), /cannot be mapped/);
  await assert.rejects(validateInitialParent({ companyId, accountTypeId: types.RETAILER, parentAccountId: f.dealer._id, dependencies: f.dependencies }), /cannot be mapped/);
  await assert.rejects(validateInitialParent({ companyId, accountTypeId: types.CUSTOMER, parentAccountId: f.distributor._id, dependencies: f.dependencies }), /cannot be mapped/);
});

test("direct Customer→Distributor is rejected for governed mapping but preserved as explicit legacy compatibility", async () => {
  const f = makeFixture();
  const legacy = await validateInitialParent({ companyId, accountTypeId: types.CUSTOMER, parentAccountId: f.distributor._id, allowLegacyDirectDistributorCustomer: true, dependencies: f.dependencies });
  assert.equal(legacy.legacyDirect, true);
  f.customer.parentAccountId = f.distributor._id; f.customer.parentRelationshipType = "distributor";
  assert.equal((await deriveChannelHierarchy({ account: f.customer, companyId, dependencies: f.dependencies })).state, "LEGACY_DIRECT_DISTRIBUTOR_CUSTOMER");
});

test("self-parent and Account parent cycles are blocked", async () => {
  const f = makeFixture();
  await assert.rejects(assertNoParentCycle({ childAccountId: f.dealer._id, parentAccountId: f.dealer._id, companyId, dependencies: f.dependencies }), /own parent/);
  f.retailer.parentAccountId = f.dealer._id;
  f.dealer.parentAccountId = f.retailer._id;
  await assert.rejects(assertNoParentCycle({ childAccountId: f.dealer._id, parentAccountId: f.retailer._id, companyId, dependencies: f.dependencies }), /cycle/);
});

test("legacy operational unmapped Dealer and Retailer remain operational and enter readiness", async () => {
  const f = makeFixture();
  assert.equal((await deriveChannelHierarchy({ account: f.dealer, companyId, dependencies: f.dependencies })).state, "LEGACY_ACTIVE_UNMAPPED");
  assert.equal((await deriveChannelHierarchy({ account: f.retailer, companyId, dependencies: f.dependencies })).state, "LEGACY_ACTIVE_UNMAPPED");
});

test("existing link to a legacy active unmapped Distributor remains readable with a warning", async () => {
  const f = makeFixture();
  f.dealer.parentAccountId = f.legacyDistributor._id; f.dealer.parentRelationshipType = "distributor";
  const result = await deriveChannelHierarchy({ account: f.dealer, companyId, dependencies: f.dependencies });
  assert.equal(result.state, "PARENT_DISTRIBUTOR_UNMAPPED");
  assert.equal(result.distributor.name, "Legacy Distributor");
});

test("Dealer preview is zero-write and returns Distributor ownership through L6", async () => {
  const f = makeFixture();
  const preview = await buildChannelMappingPreview({ payload: { childAccountId: f.dealer._id, distributorAccountId: f.distributor._id, reason: "Initial market alignment" }, user: f.user, dependencies: f.dependencies });
  assert.equal(preview.canApply, true);
  assert.equal(preview.proposed.geography.area.name, "Area A");
  assert.equal(preview.proposed.primaryFsd.fullName, "Primary FSD");
  assert.equal(preview.proposed.supervisoryOwnership.headOfSales.fullName, "Head of Sales");
  assert.equal(f.dealer.parentAccountId, null);
  assert.equal(f.audits.length, 0);
});

test("initial Dealer mapping atomically sets the existing parent pair, preserves assignedTo, and audits", async () => {
  const f = makeFixture(); const oldAssignee = f.dealer.assignedTo;
  const result = await applyChannelMapping({ payload: { childAccountId: f.dealer._id, distributorAccountId: f.distributor._id, reason: "Initial Dealer mapping" }, user: f.user, dependencies: f.dependencies });
  assert.equal(result.applied, true); assert.equal(f.dealer.parentAccountId, f.distributor._id);
  assert.equal(f.dealer.parentRelationshipType, "distributor"); assert.equal(f.dealer.assignedTo, oldAssignee);
  assert.equal(f.audits[0].action, "DEALER_DISTRIBUTOR_MAPPED");
});

test("Retailer uses the shared governed Distributor mapping engine", async () => {
  const f = makeFixture();
  await applyChannelMapping({ payload: { childAccountId: f.retailer._id, distributorAccountId: f.distributor._id, reason: "Initial Retailer mapping" }, user: f.user, dependencies: f.dependencies });
  assert.equal(f.retailer.parentAccountId, f.distributor._id);
  assert.equal(f.audits[0].action, "RETAILER_DISTRIBUTOR_MAPPED");
});

test("Customer can be governed under either a mapped Dealer or mapped Retailer", async () => {
  const dealerCase = makeFixture(); dealerCase.dealer.parentAccountId = dealerCase.distributor._id; dealerCase.dealer.parentRelationshipType = "distributor";
  await applyChannelMapping({ payload: { customerAccountId: dealerCase.customer._id, parentAccountId: dealerCase.dealer._id, reason: "Customer Dealer alignment" }, user: dealerCase.user, dependencies: dealerCase.dependencies });
  assert.equal(dealerCase.customer.parentRelationshipType, "dealer");
  const retailerCase = makeFixture(); retailerCase.retailer.parentAccountId = retailerCase.distributor._id; retailerCase.retailer.parentRelationshipType = "distributor";
  await applyChannelMapping({ payload: { customerAccountId: retailerCase.customer._id, parentAccountId: retailerCase.retailer._id, reason: "Customer Retailer alignment" }, user: retailerCase.user, dependencies: retailerCase.dependencies });
  assert.equal(retailerCase.customer.parentRelationshipType, "retailer");
});

test("cross-company parent is unavailable without tenant leakage", async () => {
  const f = makeFixture(); const foreign = makeAccount(80, "Foreign Distributor", "DISTRIBUTOR", { companyId: otherCompanyId }); f.accounts.push(foreign);
  await assert.rejects(buildChannelMappingPreview({ payload: { childAccountId: f.dealer._id, distributorAccountId: foreign._id, reason: "Cross tenant" }, user: f.user, dependencies: f.dependencies }), /not found/);
});

test("new governed mapping blocks an unmapped or reassignment-required Distributor", async () => {
  const f = makeFixture();
  const legacy = await buildChannelMappingPreview({ payload: { childAccountId: f.dealer._id, distributorAccountId: f.legacyDistributor._id, reason: "Legacy parent" }, user: f.user, dependencies: f.dependencies });
  assert.ok(legacy.blockers.includes("DISTRIBUTOR_NOT_ELIGIBLE_FOR_NEW_CHANNEL_MAPPING"));
  f.healthByDistributor.set(id(f.distributor._id), { state: "PRIMARY_FSD_GEOGRAPHY_MISMATCH", requiresReassignment: true, warnings: ["REASSIGNMENT_REQUIRED"] });
  const stale = await buildChannelMappingPreview({ payload: { childAccountId: f.dealer._id, distributorAccountId: f.distributor._id, reason: "Stale parent" }, user: f.user, dependencies: f.dependencies });
  assert.equal(stale.canApply, false);
});

test("reapplying the existing correct relationship is idempotent with no audit noise", async () => {
  const f = makeFixture(); f.dealer.parentAccountId = f.distributor._id; f.dealer.parentRelationshipType = "distributor";
  const result = await applyChannelMapping({ payload: { childAccountId: f.dealer._id, distributorAccountId: f.distributor._id, reason: "Repeat" }, user: f.user, dependencies: f.dependencies });
  assert.equal(result.idempotent, true); assert.equal(f.dealer.saveCount, undefined); assert.equal(f.audits.length, 0);
});

test("existing parent replacement and generic Account update bypass are blocked", async () => {
  const f = makeFixture(); f.dealer.parentAccountId = f.distributor._id; f.dealer.parentRelationshipType = "distributor";
  await assert.rejects(buildChannelMappingPreview({ payload: { childAccountId: f.dealer._id, distributorAccountId: f.legacyDistributor._id, reason: "Replace" }, user: f.user, dependencies: f.dependencies }).then((preview) => {
    assert.ok(preview.blockers.includes("EXISTING_PARENT_REPLACEMENT_DEFERRED")); throw new Error("replacement blocked");
  }), /replacement blocked/);
  await assert.rejects(assertChannelParentMutationAllowed({ account: f.dealer, proposedData: { parentAccountId: f.legacyDistributor._id }, companyId, dependencies: f.dependencies }), /Channel Mapping/);
});

test("Distributor Area/FSD transfer changes derived ownership without rewriting Dealer parent", async () => {
  const f = makeFixture(); f.dealer.parentAccountId = f.distributor._id; f.dealer.parentRelationshipType = "distributor";
  const before = await deriveChannelHierarchy({ account: f.dealer, companyId, dependencies: f.dependencies });
  f.healthByDistributor.set(id(f.distributor._id), { ...before.distributorHealth, geography: { area: { name: "Area B" } }, primaryFsd: { fullName: "New FSD" } });
  const after = await deriveChannelHierarchy({ account: f.dealer, companyId, dependencies: f.dependencies });
  assert.equal(before.geography.area.name, "Area A"); assert.equal(after.geography.area.name, "Area B");
  assert.equal(after.primaryFsd.fullName, "New FSD"); assert.equal(f.dealer.parentAccountId, f.distributor._id);
});

test("readiness groups Dealers, Retailers, Customers, issues, and eligible Distributors without writes", async () => {
  const f = makeFixture();
  const result = await listChannelReadiness({ user: f.user, dependencies: f.dependencies });
  assert.equal(result.dealers.length, 1); assert.equal(result.retailers.length, 1); assert.equal(result.customers.length, 2);
  assert.ok(result.issues.length >= 4); assert.equal(result.distributors.filter((item) => item.eligibleForNewMapping).length, 1);
  assert.equal(f.audits.length, 0);
});
