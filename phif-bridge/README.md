# PHIF Local Bridge

Standalone local Node service for PHIF login/session proxying and read-only invoice access.

## Environment

- `PHIF_BRIDGE_SECRET`: required for protected API calls.
- `PORT`: optional, defaults to `5174`.
- `HOST`: optional, defaults to `127.0.0.1`.
- `PHIF_BRIDGE_TIMEOUT_MS`: optional upstream request timeout, defaults to `15000`.

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
- `DELETE /api/bridge-sessions/:bridge_session_id`
- `GET|POST /phif-login/:bridge_session_id/*`

Protected API endpoints require `X-PHIF-Bridge-Secret`. Session-specific API calls also require `X-Pharmacy-Id`.

The login proxy stores PHIF cookies in memory only, scoped to one bridge session and pharmacy.

