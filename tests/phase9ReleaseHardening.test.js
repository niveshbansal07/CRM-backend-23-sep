const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "src");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const db = read("config", "db.js");
const env = read("config", "env.js");
const failureModel = read("models", "SalesAchievementCaptureFailure.js");
const orderService = read("services", "order.service.js");
const reportingService = read("services", "salesPerformanceReporting.service.js");
const achievementService = read("services", "salesAchievement.service.js");
const auditScript = fs.readFileSync(path.join(__dirname, "..", "scripts", "phase9-readiness-audit.js"), "utf8");

test("database startup never blindly enables automatic index creation", () => {
  assert.doesNotMatch(db, /autoIndex:\s*true/);
  assert.match(db, /autoIndex:\s*env\.mongoAutoIndex/);
  assert.match(db, /autoCreate:\s*false/);
});

test("automatic index creation is explicit opt-in configuration", () => {
  assert.match(env, /mongoAutoIndex:\s*process\.env\.MONGO_AUTO_INDEX\s*===\s*["']true["']/);
});

test("capture failures have a durable correlation operation ID", () => {
  assert.match(failureModel, /operationId:\s*\{[^}]*required:\s*true[^}]*index:\s*true/s);
  assert.match(failureModel, /operationId:\s*1/);
});

test("capture failure creation persists one operation ID without replacing it on retries", () => {
  assert.match(orderService, /\$setOnInsert:\s*\{[^}]*operationId:\s*new mongoose\.Types\.ObjectId\(\)/s);
  assert.doesNotMatch(orderService, /\$set:\s*\{[^}]*operationId/s);
});

test("retry audit metadata carries company-safe correlation evidence", () => {
  assert.match(reportingService, /SALES_ACHIEVEMENT_RETRY_REQUESTED[\s\S]*operationId:\s*failure\.operationId/);
  assert.match(reportingService, /SALES_ACHIEVEMENT_RETRY_SUCCEEDED[\s\S]*operationId:\s*failure\.operationId/);
  assert.match(reportingService, /SALES_ACHIEVEMENT_RETRY_FAILED[\s\S]*operationId:\s*failure\.operationId/);
});

test("Phase 9 database auditor is structurally read-only", () => {
  assert.match(auditScript, /auditMode:\s*["']READ_ONLY["']/);
  assert.match(auditScript, /autoIndex:\s*false/);
  assert.match(auditScript, /autoCreate:\s*false/);
  assert.doesNotMatch(auditScript, /\.create\(|\.insert|\.update|\.delete|syncIndexes|createIndex|dropIndex/);
});

test("Phase 9 auditor inventories collections, indexes, and uniqueness violations", () => {
  assert.match(auditScript, /listCollections/);
  assert.match(auditScript, /\.indexes\(\)/);
  ["CURRENT_EMPLOYEE_ASSIGNMENT", "CURRENT_DISTRIBUTOR_ASSIGNMENT", "OPEN_DISTRIBUTOR_REQUEST", "ACTIVE_TARGET_PLAN", "ACHIEVEMENT_SOURCE_EVENT", "CAPTURE_FAILURE_SOURCE_EVENT"].forEach((check) => assert.ok(auditScript.includes(check), check));
});

test("achievement capture has a narrow operational rollback switch", () => {
  assert.match(env, /salesAchievementCaptureEnabled:\s*process\.env\.SALES_ACHIEVEMENT_CAPTURE_ENABLED\s*!==\s*["']false["']/);
  assert.match(achievementService, /if\s*\(!env\.salesAchievementCaptureEnabled\)\s*return\s*\{\s*status:\s*["']SKIPPED_CAPTURE_DISABLED["']/);
});
