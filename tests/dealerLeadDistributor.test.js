const test = require("node:test");
const assert = require("node:assert/strict");

const Lead = require("../src/models/Lead");
const LeadType = require("../src/models/LeadType");
const Account = require("../src/models/Account");
const CrmMaster = require("../src/models/CrmMaster");
const {
  convertLeadToCustomer,
  isDealerLeadType,
  validateLeadCreatePayload,
} = require("../src/services/lead.service");

const companyA = "64b64c000000000000000001";
const companyB = "64b64c000000000000000002";
const dealerTypeId = "64b64c000000000000000003";
const distributorId = "64b64c000000000000000004";
const dealerAccountTypeId = "64b64c000000000000000005";
const customerAccountTypeId = "64b64c000000000000000006";
const userId = "64b64c000000000000000007";

const dealerLeadType = {
  _id: dealerTypeId,
  companyId: companyA,
  name: "Dealer Lead",
  code: "dealer_lead",
  isActive: true,
  requiresDealerLink: true,
};

const basePayload = (overrides = {}) => ({
  leadTypeId: dealerTypeId,
  salesExecutiveSelfie: "selfie",
  shopPhoto: "shop",
  ...overrides,
});

const queryChain = (value) => ({
  select() { return this; },
  populate() { return this; },
  lean: async () => value,
});

const withCreateValidationStubs = async ({ leadType = dealerLeadType, account = null }, callback) => {
  const originalLeadTypeFindOne = LeadType.findOne;
  const originalAccountFindOne = Account.findOne;
  const captured = { leadTypeQueries: [], accountQueries: [] };

  LeadType.findOne = (query) => {
    captured.leadTypeQueries.push(query);
    return queryChain(leadType);
  };
  Account.findOne = (query) => {
    captured.accountQueries.push(query);
    return queryChain(account);
  };

  try {
    return await callback(captured);
  } finally {
    LeadType.findOne = originalLeadTypeFindOne;
    Account.findOne = originalAccountFindOne;
  }
};

test("Dealer Lead is identified by canonical LeadType code, not display name or flags", () => {
  assert.equal(isDealerLeadType({ code: "dealer_lead", name: "Renamed" }), true);
  assert.equal(isDealerLeadType({ code: "customer_lead", name: "Dealer", requiresDistributorLink: true }), false);
});

test("Dealer Lead creation succeeds without an optional Distributor", async () => {
  await withCreateValidationStubs({}, async (captured) => {
    const result = await validateLeadCreatePayload(companyA, basePayload(), { role: "company_admin" });
    assert.equal(result.leadType.code, "dealer_lead");
    assert.equal(captured.accountQueries.length, 0);
  });
});

test("Dealer Lead accepts a same-company active Distributor account", async () => {
  const distributor = {
    _id: distributorId,
    companyId: companyA,
    status: "partner",
    accountTypeId: { code: "DISTRIBUTOR", module: "account", type: "account_type", isActive: true },
  };

  await withCreateValidationStubs({ account: distributor }, async (captured) => {
    await validateLeadCreatePayload(
      companyA,
      basePayload({ linkedDistributorId: distributorId }),
      { role: "company_admin" }
    );
    assert.equal(captured.accountQueries[0].companyId, companyA);
    assert.equal(captured.accountQueries[0].deletedAt, null);
    assert.deepEqual(captured.accountQueries[0].status, { $ne: "inactive" });
  });
});

test("Dealer Lead rejects Dealer or Customer accounts submitted as Distributor", async () => {
  const dealer = {
    _id: distributorId,
    companyId: companyA,
    status: "partner",
    accountTypeId: { code: "DEALER", module: "account", type: "account_type", isActive: true },
  };

  await withCreateValidationStubs({ account: dealer }, async () => {
    await assert.rejects(
      validateLeadCreatePayload(
        companyA,
        basePayload({ linkedDistributorId: distributorId }),
        { role: "company_admin" }
      ),
      /not a Distributor/
    );
  });
});

test("cross-company, deleted, or inactive Distributor is rejected as unavailable", async () => {
  await withCreateValidationStubs({ account: null }, async (captured) => {
    await assert.rejects(
      validateLeadCreatePayload(
        companyA,
        basePayload({ linkedDistributorId: distributorId }),
        { role: "company_admin" }
      ),
      /no longer available/
    );
    assert.equal(captured.accountQueries[0].companyId, companyA);
    assert.notEqual(captured.accountQueries[0].companyId, companyB);
  });
});

test("non-Dealer Lead remains valid without linkage and rejects crafted Distributor linkage", async () => {
  const nonDealerType = {
    ...dealerLeadType,
    code: "distributor_lead",
    requiresDealerLink: false,
    requiresDistributorLink: true,
  };

  await withCreateValidationStubs({ leadType: nonDealerType }, async () => {
    await validateLeadCreatePayload(companyA, basePayload(), { role: "company_admin" });
    await assert.rejects(
      validateLeadCreatePayload(
        companyA,
        basePayload({ linkedDistributorId: distributorId }),
        { role: "company_admin" }
      ),
      /only available for Dealer leads/
    );
  });
});

const withConversionStubs = async ({ leadTypeCode = "dealer_lead", linkedDistributorId = distributorId }, callback) => {
  const originals = {
    leadFindOne: Lead.findOne,
    leadTypeFindOne: LeadType.findOne,
    accountFindOne: Account.findOne,
    accountCreate: Account.create,
    masterFindOne: CrmMaster.findOne,
  };
  const captured = { accountQueries: [], createdAccounts: [] };
  const lead = {
    _id: "64b64c000000000000000008",
    companyId: companyA,
    leadTypeId: dealerTypeId,
    linkedDistributorId,
    linkedDealerId: null,
    linkedAccountId: null,
    name: "New Channel Partner",
    assignedTo: userId,
    createdBy: userId,
    save: async () => lead,
  };

  Lead.findOne = async () => lead;
  LeadType.findOne = () => queryChain({ _id: dealerTypeId, code: leadTypeCode });
  CrmMaster.findOne = (query) => queryChain({
    _id: query.$or?.some((condition) => condition.code === "DEALER")
      ? dealerAccountTypeId
      : customerAccountTypeId,
  });
  Account.findOne = (query) => {
    captured.accountQueries.push(query);
    return queryChain({
      _id: distributorId,
      companyId: companyA,
      status: "partner",
      accountTypeId: { code: "DISTRIBUTOR", module: "account", type: "account_type", isActive: true },
    });
  };
  Account.create = async (data) => {
    const account = { _id: "64b64c000000000000000009", ...data };
    captured.createdAccounts.push(account);
    return account;
  };

  try {
    return await callback({ captured, lead });
  } finally {
    Lead.findOne = originals.leadFindOne;
    LeadType.findOne = originals.leadTypeFindOne;
    Account.findOne = originals.accountFindOne;
    Account.create = originals.accountCreate;
    CrmMaster.findOne = originals.masterFindOne;
  }
};

test("Dealer Lead conversion creates a Dealer under the selected Distributor", async () => {
  await withConversionStubs({}, async ({ captured }) => {
    const result = await convertLeadToCustomer(companyA, "lead-a", {}, { _id: userId, role: "sales_executive" });
    const account = captured.createdAccounts[0];
    assert.equal(account.accountType, "dealer");
    assert.equal(account.accountTypeId, dealerAccountTypeId);
    assert.equal(account.status, "partner");
    assert.equal(String(account.parentAccountId), distributorId);
    assert.equal(account.parentRelationshipType, "distributor");
    assert.equal(String(result.lead.convertedAccountId), String(account._id));
    assert.equal(captured.accountQueries[0].companyId, companyA);
  });
});

test("Dealer Lead without Distributor converts with no parent hierarchy", async () => {
  await withConversionStubs({ linkedDistributorId: null }, async ({ captured }) => {
    await convertLeadToCustomer(companyA, "lead-a", {}, { _id: userId, role: "sales_executive" });
    assert.equal(captured.createdAccounts[0].accountType, "dealer");
    assert.equal(captured.createdAccounts[0].parentAccountId, null);
    assert.equal(captured.createdAccounts[0].parentRelationshipType, null);
    assert.equal(captured.accountQueries.length, 0);
  });
});

test("non-Dealer conversion retains existing Customer conversion behavior", async () => {
  await withConversionStubs({ leadTypeCode: "customer_lead", linkedDistributorId: null }, async ({ captured }) => {
    await convertLeadToCustomer(companyA, "lead-a", {}, { _id: userId, role: "sales_executive" });
    assert.equal(captured.createdAccounts[0].accountType, "customer");
    assert.equal(captured.createdAccounts[0].accountTypeId, customerAccountTypeId);
    assert.equal(captured.createdAccounts[0].status, "customer");
  });
});
