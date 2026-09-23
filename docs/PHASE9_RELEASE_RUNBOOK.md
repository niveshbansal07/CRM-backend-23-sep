# Phase 9 Sales Architecture Release Runbook

This runbook performs no business-data repair. Replace placeholders through the existing secret manager; never put credentials in shell history, logs, or this file.

## Safety gate

1. Set `PHASE9_ENVIRONMENT` explicitly to `LOCAL`, `TEST`, `STAGING`, or `PRODUCTION`.
2. Confirm the resolved database and deployment target with the release owner.
3. Keep `MONGO_AUTO_INDEX=false` during diagnostics and rollout.
4. Do not run write validation against production.
5. Stop all writes when backup status, topology, or tenant-isolated fixtures are unclear.

Run the read-only inventory from `Backend`:

```powershell
$env:PHASE9_ENVIRONMENT='STAGING'
npm run audit:phase9
```

The command never calls collection/index creation, mutation, or deletion APIs. Resolve every reported uniqueness violation before creating a unique index.

## Backup and disposable restore

Follow the organization's encryption and storage convention. Record operator, UTC timestamp, database scope, encrypted archive location, checksum, and retention ticket.

```powershell
mongodump --uri $env:MONGO_URI --archive=$env:PHASE9_BACKUP_ARCHIVE --gzip
```

Restore only to a disposable database, using an independently supplied restore URI:

```powershell
mongorestore --uri $env:PHASE9_RESTORE_URI --archive=$env:PHASE9_BACKUP_ARCHIVE --gzip --drop
```

After restore, compare collection names and document counts with the source backup manifest. Never use `--drop` against staging or production.

## Correctness-critical index rollout

Run these only after the read-only audit reports no conflicting definition or duplicate data. Treat all unique indexes as `REQUIRES_DATA_CLEANUP` when violations exist; otherwise schedule them in an operational window. Existing non-unique performance indexes should be reconciled from the Mongoose schema inventory without dropping unknown indexes automatically.

```javascript
db.salesemployeegeographyassignments.createIndex(
  { companyId: 1, employeeId: 1, assignmentType: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true, deletedAt: null }, name: "uniq_current_primary_assignment_per_employee" }
)
db.salesemployeegeographyassignments.createIndex(
  { companyId: 1, geographyId: 1, isResponsibleManager: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true, isResponsibleManager: true, deletedAt: null }, name: "uniq_current_responsible_manager_per_geography" }
)
db.distributorsalesassignments.createIndex(
  { companyId: 1, distributorAccountId: 1 },
  { unique: true, partialFilterExpression: { isCurrent: true, deletedAt: null }, name: "uniq_current_distributor_sales_mapping" }
)
db.distributorreassignmentrequests.createIndex(
  { companyId: 1, distributorAccountId: 1 },
  { unique: true, partialFilterExpression: { isOpen: true, deletedAt: null }, name: "uniq_open_distributor_reassignment" }
)
db.companysequences.createIndex({ companyId: 1, key: 1 }, { unique: true, name: "uniq_company_sequence_key" })
db.companysalesperformancepolicies.createIndex({ companyId: 1 }, { unique: true, name: "uniq_company_performance_policy" })
db.salestargetplans.createIndex(
  { companyId: 1, metricCode: 1, periodStart: 1, periodEndExclusive: 1, version: 1 },
  { unique: true, name: "uniq_target_plan_version" }
)
db.salestargetplans.createIndex(
  { companyId: 1, metricCode: 1, periodStart: 1, periodEndExclusive: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" }, name: "uniq_active_target_period" }
)
db.salestargetallocations.createIndex(
  { companyId: 1, planId: 1, ownerType: 1, ownerId: 1 },
  { unique: true, name: "uniq_target_allocation_owner" }
)
db.salesachievementevents.createIndex(
  { companyId: 1, sourceType: 1, sourceId: 1, sourceEvent: 1, sourceEventVersion: 1 },
  { unique: true, name: "uniq_sales_achievement_source_event" }
)
db.salesachievementcapturefailures.createIndex(
  { companyId: 1, orderId: 1, sourceEvent: 1, sourceEventVersion: 1 },
  { unique: true, name: "uniq_sales_achievement_capture_failure" }
)
db.salesachievementcapturefailures.createIndex(
  { companyId: 1, operationId: 1 },
  { unique: true, sparse: true, name: "uniq_sales_achievement_failure_operation" }
)
```

Do not use `syncIndexes()` in production: it can drop indexes not declared by the current application version.

## Index rollback

- Do not drop a correctness/uniqueness index while its write workflow is enabled.
- A performance-only index may be dropped only after query-plan evidence, dependency review, and approval.
- If index creation causes operational pressure, stop the build; retain successfully built correctness indexes and reschedule remaining performance indexes.
- Application rollback must continue to honor every uniqueness assumption made by retained history.

## Application and data rollback

- Never delete Sales Geography, employee assignment/lifecycle, Distributor assignment/request, Target plan/allocation, achievement-event, or capture-failure history.
- Preserve Phase 7 backend visibility during every rollback.
- To disable Target capture, deploy with `SALES_ACHIEVEMENT_CAPTURE_ENABLED=false` and disable Target mutation UI if required. Do not truncate collections or move activation before deployment.
- Roll back application artifacts only after confirming the older artifact tolerates the retained schema and data.

## Monitoring gates

Alert or dashboard by company without logging secrets or request payloads:

- Achievement capture failures, oldest open failure, retry success/failure, duplicate event conflicts, unattributable count/amount.
- Transaction aborts, transient transaction errors, write conflicts, retry exhaustion, duplicate-current conflicts.
- Target submission/approval failures, allocation validation failures, active-plan conflicts, dashboard latency, export failures.
- Unassigned or conflicted Sales employees, legacy active unmapped Distributors, Distributor reassignment-required state, channel conflicts, and unmapped Dealer/Retailer counts.

Failure logs must carry company ID, operation ID, source entity ID, and safe error code. Never log passwords, tokens, connection strings, or unfiltered request bodies.

## Production sequence

1. Freeze code and identify the immutable artifacts.
2. Confirm encrypted backup and disposable restore evidence.
3. Confirm replica-set/sharded transaction support.
4. Run the read-only Phase 9 audit.
5. Resolve blocking duplicates through a separately approved remediation.
6. Create missing collections/indexes in the approved operational window.
7. Deploy backend with `MONGO_AUTO_INDEX=false` and run health checks.
8. Deploy frontend and run L1–L6 visibility plus cross-company negative tests.
9. Run Distributor, channel hierarchy, and optional Dealer Lead smoke tests.
10. Configure Target policy with `SALES_ACHIEVEMENT_CAPTURE_ENABLED=false` until values and boundary are approved.
11. Activate at an explicit current/future boundary, then enable capture and restart the backend; never activate retroactively.
12. Book one controlled Order and verify one achievement event, amount, attribution, and scorecard.
13. Exercise durable failure/retry idempotency with an isolated fixture.
14. Validate revision maker/checker, exports, and dashboard latency.
15. Monitor before wider enablement.
