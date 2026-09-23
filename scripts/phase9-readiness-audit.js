require("dotenv").config();
const mongoose = require("mongoose");

const MODEL_NAMES = [
  "SalesGeography",
  "SalesEmployeeGeographyAssignment",
  "SalesEmployeeLifecycleEvent",
  "DistributorSalesAssignment",
  "DistributorReassignmentRequest",
  "CompanySequence",
  "CompanySalesPerformancePolicy",
  "SalesTargetPlan",
  "SalesTargetAllocation",
  "SalesAchievementEvent",
  "SalesAchievementCaptureFailure",
];

const models = Object.fromEntries(MODEL_NAMES.map((name) => [name, require(`../src/models/${name}`)]));
const stable = (value) => JSON.stringify(value || {});
const environmentSignal = () => {
  const explicit = String(process.env.PHASE9_ENVIRONMENT || "").trim().toUpperCase();
  if (["LOCAL", "TEST", "STAGING", "PRODUCTION"].includes(explicit)) return explicit;
  return "UNKNOWN";
};
const indexShape = ([key, options = {}]) => ({
  key,
  unique: Boolean(options.unique),
  partialFilterExpression: options.partialFilterExpression || null,
  sparse: Boolean(options.sparse),
  name: options.name || null,
});
const actualIndexShape = (index) => ({
  key: index.key,
  unique: Boolean(index.unique),
  partialFilterExpression: index.partialFilterExpression || null,
  sparse: Boolean(index.sparse),
  name: index.name || null,
});
const sameDefinition = (expected, actual) => expected.unique === actual.unique
  && expected.sparse === actual.sparse
  && stable(expected.partialFilterExpression) === stable(actual.partialFilterExpression);

const duplicateChecks = [
  ["CURRENT_EMPLOYEE_ASSIGNMENT", "salesemployeegeographyassignments", { isCurrent: true, deletedAt: null }, { companyId: "$companyId", employeeId: "$employeeId", assignmentType: "$assignmentType" }],
  ["CURRENT_RESPONSIBLE_MANAGER", "salesemployeegeographyassignments", { isCurrent: true, isResponsibleManager: true, deletedAt: null }, { companyId: "$companyId", geographyId: "$geographyId" }],
  ["CURRENT_DISTRIBUTOR_ASSIGNMENT", "distributorsalesassignments", { isCurrent: true, deletedAt: null }, { companyId: "$companyId", distributorAccountId: "$distributorAccountId" }],
  ["OPEN_DISTRIBUTOR_REQUEST", "distributorreassignmentrequests", { isOpen: true, deletedAt: null }, { companyId: "$companyId", distributorAccountId: "$distributorAccountId" }],
  ["PERFORMANCE_POLICY", "companysalesperformancepolicies", {}, { companyId: "$companyId" }],
  ["TARGET_PLAN_VERSION", "salestargetplans", {}, { companyId: "$companyId", metricCode: "$metricCode", periodStart: "$periodStart", periodEndExclusive: "$periodEndExclusive", version: "$version" }],
  ["ACTIVE_TARGET_PLAN", "salestargetplans", { status: "ACTIVE" }, { companyId: "$companyId", metricCode: "$metricCode", periodStart: "$periodStart", periodEndExclusive: "$periodEndExclusive" }],
  ["TARGET_ALLOCATION_OWNER", "salestargetallocations", {}, { companyId: "$companyId", planId: "$planId", ownerType: "$ownerType", ownerId: "$ownerId" }],
  ["ACHIEVEMENT_SOURCE_EVENT", "salesachievementevents", {}, { companyId: "$companyId", sourceType: "$sourceType", sourceId: "$sourceId", sourceEvent: "$sourceEvent", sourceEventVersion: "$sourceEventVersion" }],
  ["CAPTURE_FAILURE_SOURCE_EVENT", "salesachievementcapturefailures", {}, { companyId: "$companyId", orderId: "$orderId", sourceEvent: "$sourceEvent", sourceEventVersion: "$sourceEventVersion" }],
  ["EMPLOYEE_LIFECYCLE_OPERATION", "salesemployeelifecycleevents", {}, { operationId: "$operationId" }],
  ["DISTRIBUTOR_ASSIGNMENT_OPERATION", "distributorsalesassignments", {}, { operationId: "$operationId" }],
  ["DISTRIBUTOR_REQUEST_OPERATION", "distributorreassignmentrequests", {}, { operationId: "$operationId" }],
  ["CAPTURE_FAILURE_OPERATION", "salesachievementcapturefailures", { operationId: { $exists: true } }, { companyId: "$companyId", operationId: "$operationId" }],
];

const run = async () => {
  if (!process.env.MONGO_URI) throw Object.assign(new Error("MONGO_URI is required"), { code: "MONGO_URI_MISSING" });
  const environment = environmentSignal();
  const startedAt = new Date();
  await mongoose.connect(process.env.MONGO_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 15000,
  });
  const db = mongoose.connection.db;
  const hello = await db.admin().command({ hello: 1 });
  const clientOptions = mongoose.connection.getClient().options || {};
  const existingCollections = await db.listCollections({}, { nameOnly: true }).toArray();
  const collectionNames = new Set(existingCollections.map((item) => item.name));
  const inventory = [];
  for (const [modelName, model] of Object.entries(models)) {
    const collection = model.collection.name;
    const expected = model.schema.indexes().map(indexShape);
    let actual = [];
    if (collectionNames.has(collection)) actual = (await db.collection(collection).indexes()).map(actualIndexShape);
    const actualByKey = new Map(actual.map((item) => [stable(item.key), item]));
    const missing = [];
    const conflicting = [];
    for (const item of expected) {
      const found = actualByKey.get(stable(item.key));
      if (!found) missing.push(item);
      else if (!sameDefinition(item, found)) conflicting.push({ expected: item, actual: found });
    }
    inventory.push({ model: modelName, collection, exists: collectionNames.has(collection), expectedIndexCount: expected.length, actualIndexCount: actual.length, missing, conflicting });
  }
  const duplicates = [];
  for (const [check, collection, match, groupId] of duplicateChecks) {
    if (!collectionNames.has(collection)) {
      duplicates.push({ check, collection, status: "COLLECTION_MISSING", violationCount: null, examples: [] });
      continue;
    }
    const rows = await db.collection(collection).aggregate([
      { $match: match },
      { $group: { _id: groupId, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 10 },
    ], { allowDiskUse: false, maxTimeMS: 30000 }).toArray();
    duplicates.push({ check, collection, status: rows.length ? "VIOLATIONS_FOUND" : "CLEAR", violationCount: rows.length, examples: rows });
  }
  return {
    auditMode: "READ_ONLY",
    environment,
    writesAllowed: false,
    startedAt,
    completedAt: new Date(),
    topology: {
      type: hello.msg === "isdbgrid" ? "SHARDED" : hello.setName ? "REPLICA_SET" : "STANDALONE",
      transactionCapable: Boolean((hello.setName || hello.msg === "isdbgrid") && hello.logicalSessionTimeoutMinutes),
      sessionsSupported: Boolean(hello.logicalSessionTimeoutMinutes),
      maxWireVersion: hello.maxWireVersion,
    },
    connectionOptions: {
      autoIndex: false,
      autoCreate: false,
      retryWrites: clientOptions.retryWrites,
      maxPoolSize: clientOptions.maxPoolSize,
      minPoolSize: clientOptions.minPoolSize,
      readConcern: clientOptions.readConcern || null,
      writeConcern: clientOptions.writeConcern || null,
    },
    collectionInventory: inventory,
    duplicateChecks: duplicates,
  };
};

run()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => {
    console.error(JSON.stringify({ auditMode: "READ_ONLY", environment: environmentSignal(), connected: false, errorCode: error.code || error.name || "AUDIT_FAILED" }));
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect().catch(() => {}));
