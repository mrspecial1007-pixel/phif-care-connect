# Order detail JSON validation upgrade

## Scope

Migration: `supabase/migrations/20261125010000_allow_order_detail_fields.sql`.
Previous function and rollback: `supabase/rollback/20261125010000_restore_order_detail_validation.sql`.
Diff: `docs/order-detail-fields-validation.diff`.

The previous definition was read from Cloud on 2026-11-25 and matches the
function in migration 20261026010000. Re-read it before any deployment; stop
if its body, signature, owner, EXECUTE ACL or security settings have changed.

Only the line JSON validation block changes. No table, existing report,
receipt confirmation, observation, operation or audit log is modified by
this migration. CREATE OR REPLACE retains function identity, owner and ACL.
SECURITY DEFINER and search_path remain pg_catalog,pg_temp.

Optional fields: batchId (numeric text or null), requestedQuantity,
supplierQuantity and receivedQuantity (nonnegative JSON numbers or null),
deliveredAt (ISO timestamp with timezone or null), fulfillmentStage (enum).
approvedAt accepts an ISO timestamp with timezone as well as null/missing.
Existing receivedAt validation is unchanged. A malformed calendar timestamp
may raise PostgreSQL's date error instead of the generic validation error;
the transaction is still rejected without writes.

ready and in_delivery require status=waiting. Other stages require their
matching legacy status. Null quantities are never inferred, and delivery
does not establish receipt. Approved-zero exclusion remains unchanged.

## Isolated verification

Run `node supabase/tests/order-detail-fields.test.mjs` with PGlite installed
outside the project and PHIF_TEST_PGLITE_MODULE pointing at its dist/index.js.
The test creates a new in-memory PostgreSQL instance; it takes no database URL.
It executes the actual existing dependency migrations and the new function.
No Cloud access, PHIF requests, credentials, real orders or patients are used.

## Deployment gate (not executed)

1. Obtain separate approval. Back up the live function definition, security
   attributes, and existing snapshots/receipt data through approved tooling.
2. Pause manual order refresh and wait for any active operation to finish.
3. Verify the previous function still matches, then apply the migration in
   its transaction. Verify owner, signature, ACL and search_path unchanged.
4. Deploy the compatible Tracker reader and Bridge parser together. Old
   Tracker readers reject non-null approvedAt and may strip the new fields;
   do not enable the new Bridge against the old Tracker.
5. No live synchronization or test writes without separate authorization.

## Rollback (not executed)

Pause refresh first. Apply the rollback SQL in a transaction only after
checking for intervening function changes. It restores the old function
validation, not the data. Previously saved richer reports remain intact.
Do not downgrade to a reader that rejects those reports. Retain the tolerant
reader, and disable new refreshes until the writer/validator versions agree.
Never delete fields or restore older snapshots to make rollback pass.

The local test proves rollback restores the original body and attributes,
leaves saved data intact, and allows reapplying the migration. This is not a
production concurrency or deployed-application verification.
