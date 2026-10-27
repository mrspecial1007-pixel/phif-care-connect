# PHIF Order Receipt Dates

Local implementation only. Apply `supabase/migrations/20261025010000_add_phif_order_receipts.sql` manually after approval; no production migration or data import is performed by the app.

- `phif_order_receipts` stores a shared pharmacy/order/line identity, the last PHIF status, the first observed receipt transition, and an independently confirmed manual receipt date. Dates survive browser/device changes because they live in Cloud, not in IndexedDB. A device still needs an order snapshot to display its orders.
- `phif_order_receipt_sync` rejects stale complete reads. Initial already-received lines never receive an invented observation date. A subsequent waiting/pending-approval to received transition records the database clock once; it is not a PHIF receipt date.
- Only successful, complete explicit PHIF refreshes feed observations. Missing old orders, identity changes, duplicate identities or an RPC failure roll back the entire observation transaction. Lines omitted by the approved-zero filter retain their existing history without being deleted or reset. No PHIF write/receipt operation is performed.
- A registered active manager can confirm/edit/revoke a receipt date on a tracked received line. First refresh once after enabling the migration to initialize existing line identities. No legacy-PIN impersonation, client-supplied pharmacy/actor or unknown line creation is allowed in the date-saving RPC.
- Manual dates must be between the order creation day and today (Africa/Tripoli). Calendar-day duration uses the confirmed date. Observation dates never enter actual duration calculations. Unknown original creation dates block confirmation instead of inventing a duration.
- Updates are version checked, audited in the existing `user_operation_log`, and applied to the access/metadata cache after database confirmation. Original PHIF snapshots, invoice/cost/stock data and the first observation remain unchanged.
- Client database roles have no table/RPC access. The server service role has SELECT on receipt rows and EXECUTE on scoped SECURITY DEFINER functions only, with an explicit safe search_path and ownership/privilege checks. Functions verify active pharmacy users; manual edits require admin.
- Read permissions and official exports keep the existing inventory/export checks. Exports reload shared date records server-side after signature verification; supplied client dates are not trusted. Failed date reads stop exports rather than quietly using stale manual dates.
- Period filters default to order creation. Confirmed receipt dates and unconfirmed first observations are separately selectable. Pending approval, approved waiting, received and review remain separate; explicit zero quantities stay excluded.
- Excel contains separate actual date, date source and observation columns. PDF supports both the existing nonreceived statement and a filtered all-status statement. Neither report treats observation dates as actual receipt dates.
- Without the migration, existing order monitoring stays readable, a configuration message explains why shared date editing is unavailable, and no automatic schema creation is attempted.

Tests use mocks and an isolated in-memory PostgreSQL instance only. Live Cloud persistence and multi-device operation require approved migration/deployment and are not claimed as production-tested.
