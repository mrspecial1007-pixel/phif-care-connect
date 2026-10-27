# Shared orders and manual-only PHIF synchronization

## Status

Local implementation only. No migration, data write, sync, Bridge restart, commit,
push or deployment has been performed. SQL requires separate approval.

## SQL and rollout order

1. The receipt migration is ALREADY installed in Cloud. Do not reapply it.
   Read-only inspection on 2026-10-26 confirmed both receipt tables, both RPCs,
   matching column types/indexes, postgres ownership and safe execution grants
   in project `fbyueyahceskequodohk`. The new migration verifies these contracts
   before creating anything and aborts on incompatibility or unsafe privileges.
   All three installed receipt/stock RPC bodies were also compared with the
   locally tested baseline and match exactly after normalizing line endings.
2. Review `20261026010000_add_shared_orders_and_manual_sync.sql` and apply only
   after approval. Deploy the matching application code together: old deployments
   are deliberately prevented from applying stock without a managed lease.
3. Perform one explicit manual orders refresh after approval. Existing IndexedDB
   data is not uploaded automatically. Subsequent authorized devices/domains read
   the shared Cloud snapshot without a PHIF session.

The migration adds `phif_order_snapshots` (one complete report per pharmacy) and
`phif_manual_sync_operations` (audited, actor/session-bound leases). It does not
backfill or reset any existing run or change invoice/financial data. It requires
a privileged owner, uses explicit schemas with a safe search path, revokes direct
application table writes even from `service_role`, and exposes only service-only
RPCs after server session authorization. Users with inventory access share the
pharmacy's data, but encryption/signatures and client caches remain user-scoped.
Effective ownership, inherited/column grants, internal-RPC execution and search
paths are checked after DDL; failure rolls back the entire migration, including
the stock-RPC rename. BYPASSRLS alone does not bypass object ACL checks.

## Update policy

- Opening a page, focus, reconnect, export and timers never contact PHIF/Bridge.
- The header reads DB metadata once; it never probes `/home` or refreshes cookies.
  Green means a successful manual stock/orders operation in the last minute for
  the current saved session. Old/uncertain evidence is explicitly unverified,
  not an assertion of current authentication. A local timer can expire the
  displayed evidence without making a network request.
- Only the existing explicit manual stock/orders actions fetch upstream data.
  Their Tracker reads have a 120-second timeout; Bridge has a 115-second deadline,
  cancels reads on client disconnect and rejects overlapping stock/orders reads
  for the same pharmacy. Loading this Bridge change later requires a separately
  approved restart; no service has been restarted during local development.
  A database lock serializes these
  two operations across users, devices and deployments, with a three-minute
  lease and ten-second cooldown after an operation finishes. Expired managed
  lease recovery is exempt from that cooldown. Starting while the DB write lock
  is busy fails immediately instead of waiting. No heartbeat/network polling.
- Stock snapshots and completed run state commit atomically. A stale managed
  worker cannot apply data after failure, expiry or replacement. Expired managed
  leases may be reclaimed only by another explicit manual action.
- Orders version checks, complete snapshot replacement and receipt observations
  are one transaction. Partial, stale, conflicting or truncated reports retain
  the previous report and dates. Manual receipt dates are never overwritten.
  Equal or older receipt-observation timestamps are rejected before publishing
  a different report; the existing observer's equal-time no-op is not bypassed.
- IndexedDB is an encrypted, user-scoped fallback/cache, not shared storage.
  A cache-write failure does not report a successful Cloud save as a failed sync.
- Cloud exports use the saved signed report and fresh receipt records; they make
  no PHIF request and preserve the last successful source timestamp.

## Existing unmanaged pending stock runs

The code returns a clear review-required error; it never resets these by age.
Read-only Cloud inspection on 2026-10-26 found one unmanaged pending run,
`6b0c458b-e819-490d-a6c4-2d8afff7536b`, started 2026-10-25 22:02:40 UTC,
with zero associated snapshots. No row was changed. This does not prove that
its worker is dead. It will still block manual stock/orders refresh until a
separate, explicitly approved resolution of that exact row. It does not block
the additive migration itself or reading saved Cloud orders.
Recheck the exact run before any separately approved repair:

```sql
SELECT r.id,r.pharmacy_id,r.started_at,r.finished_at,r.status,
       r.total_records,r.imported_records,r.error_count,r.error_message,
       (SELECT count(*) FROM public.phif_stock_items s
        WHERE s.pharmacy_id=r.pharmacy_id AND s.sync_run_id=r.id) AS associated_snapshots,
       o.id AS managed_operation_id,o.status AS managed_status,o.expires_at
FROM public.phif_stock_sync_runs r
LEFT JOIN public.phif_manual_sync_operations o
  ON o.id=r.id AND o.pharmacy_id=r.pharmacy_id AND o.kind='stock'
WHERE r.pharmacy_id=:pharmacy_id AND r.status='pending';
```

This is not a repair command. Snapshot counts alone do not prove completion.
Closing a legacy run requires evidence and separate approval for that exact row.
No batch reset, deletion or automatic retry is included.
