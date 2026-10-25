# PHIF Local Bridge

Standalone local Node service for PHIF login/session proxying and read-only invoice access.

## Environment

- `PHIF_BRIDGE_SECRET`: required for protected API calls.
- `PORT`: optional, defaults to `5174`.
- `HOST`: optional, defaults to `127.0.0.1`.
- `PHIF_BRIDGE_TIMEOUT_MS`: optional upstream request timeout, defaults to `15000`.
- `PHIF_TIRYAQ_SOURCE_PHARMACY_ID`: required PHIF source pharmacy ID for stock and order reads.

## Start

```powershell
$env:PHIF_BRIDGE_SECRET="replace-with-local-secret"
node phif-bridge/server.js
```

## Endpoints

- `GET /api/health`
- `POST /api/bridge-sessions`
- `GET /api/bridge-sessions/:bridge_session_id/login-url`
- `GET /api/bridge-sessions/:bridge_session_id/status`
- `GET /api/bridge-sessions/:bridge_session_id/today-transactions`
- `GET /api/bridge-sessions/:bridge_session_id/invoices/:invoice_key`
- `GET /api/bridge-sessions/:bridge_session_id/orders`
- `DELETE /api/bridge-sessions/:bridge_session_id`
- `GET|POST /phif-login/:bridge_session_id/*`

Protected API endpoints require `X-PHIF-Bridge-Secret`. Session-specific API calls also require `X-Pharmacy-Id`.

The login proxy stores PHIF cookies in memory only, scoped to one bridge session and pharmacy.

## Order Monitoring (Read Only)

The orders endpoint reads `/get-pharmacy-request-index`, verifies its declared total,
and follows DataTables `start`/`length` pagination when necessary. It reads details only
for IDs returned by that pharmacy's list, with at most three concurrent detail requests.
Mixed pharmacies/branches, stalled pagination and duplicate identities are rejected.
The overall read budget is 60 seconds; a timeout requires a fresh read, not a partial success.

Order routes are not available through the login proxy. No receipt or order-creation
route is permitted. Explicitly approved zero quantities are excluded; missing quantities
remain unknown. A quantity on a pending approval is not treated as supplier acceptance.
Failed details remain explicit errors, and Tracker blocks official exports until every
order's details have been read successfully.

Tracker uses existing `inventory_read` and `reports_export` permissions. The page is
`/management/orders`; its cache is scoped to pharmacy, user and permissions, and is
cleared on session changes. All persistence remains unchanged.

`fetchedAt` means the time of this read, not a supplier approval or receipt timestamp.
PHIF did not expose per-line approval/receipt dates in the inspected sources. Future
first-observed tracking could record pharmacy + order ID + line ID + state + first seen
timestamp separately, with immutable change history. Such a timestamp would be an
observation, never the actual historical event date. No such storage is implemented here.

