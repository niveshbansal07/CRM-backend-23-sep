const CrmMaster = require("../models/CrmMaster");
const CompanySequence = require("../models/CompanySequence");
const ApiError = require("../utils/ApiError");

const DISTRIBUTOR_SEQUENCE_KEY = "DISTRIBUTOR_BUSINESS_ID";
const DISTRIBUTOR_TYPE_CODE = "DISTRIBUTOR";

const withSession = (query, session) => session && query?.session ? query.session(session) : query;
const toId = (value) => value?._id || value?.id || value || null;

const getAccountTypeMaster = async ({ companyId, accountTypeId, session = null, CrmMasterModel = CrmMaster }) => {
  const populated = accountTypeId && typeof accountTypeId === "object" && accountTypeId.code
    ? accountTypeId
    : null;
  if (populated) return populated;
  if (!accountTypeId) return null;
  return withSession(CrmMasterModel.findOne({
    _id: toId(accountTypeId),
    companyId,
    module: "account",
    type: "account_type",
  }), session);
};

const isCanonicalDistributorType = (master) => (
  String(master?.module || "").toLowerCase() === "account" &&
  String(master?.type || "").toLowerCase() === "account_type" &&
  String(master?.code || "").toUpperCase() === DISTRIBUTOR_TYPE_CODE
);

const assertCanonicalDistributorAccount = async ({
  account,
  companyId,
  session = null,
  CrmMasterModel = CrmMaster,
}) => {
  const type = await getAccountTypeMaster({
    companyId,
    accountTypeId: account?.accountTypeId,
    session,
    CrmMasterModel,
  });
  if (!isCanonicalDistributorType(type) || type.isActive === false) {
    throw new ApiError(400, "Account must use the active canonical DISTRIBUTOR Account Type");
  }
  return type;
};

const allocateDistributorBusinessId = async ({
  companyId,
  session = null,
  SequenceModel = CompanySequence,
}) => {
  let sequence;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      sequence = await SequenceModel.findOneAndUpdate(
        { companyId, key: DISTRIBUTOR_SEQUENCE_KEY },
        {
          $inc: { value: 1 },
          $setOnInsert: { companyId, key: DISTRIBUTOR_SEQUENCE_KEY },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) }
      );
      break;
    } catch (error) {
      if (error?.code !== 11000 || attempt === 2) throw error;
    }
  }
  if (!sequence?.value) throw new ApiError(500, "Unable to allocate Distributor business ID");
  return `DIST-${String(sequence.value).padStart(6, "0")}`;
};

module.exports = {
  DISTRIBUTOR_SEQUENCE_KEY,
  DISTRIBUTOR_TYPE_CODE,
  getAccountTypeMaster,
  isCanonicalDistributorType,
  assertCanonicalDistributorAccount,
  allocateDistributorBusinessId,
};
