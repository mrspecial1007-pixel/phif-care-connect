# SMS Gateway Secure Pairing Plan

The current pairing failure (HTTP 400) is caused by the backend's `registerGatewayDevice` function requiring an authenticated pharmacy session (`getPharmacySession()`). Since the Android app is not a browser, it cannot send the necessary session cookies, leading to an "Unauthorized" error. Furthermore, public registration is a security risk.

## Secure Pairing Model
We will implement a code-based pairing flow similar to smart TV activation:
1. **Request Code**: The pharmacy (logged into the web app) generates a short-lived, 6-character pairing code.
2. **Input Code**: The user enters this code in the Android app.
3. **Register**: The `/api/public/gateway/register` endpoint validates the code to identify the pharmacy and authorizes the device.

## Proposed Changes

### 1. Database Schema
- Create `gateway_pairing_codes` table: `id`, `pharmacy_id`, `code` (6 chars), `expires_at`, `is_used`.

### 2. Backend Logic
- **`src/lib/sms-gateway.functions.ts`**:
    - `generatePairingCode`: Server function (authenticated) to create a code.
    - `registerGatewayDevice`: Update to accept `pairingCode` instead of relying on a session. Validate the code, bind to `pharmacy_id`, and mark code as used.
- **`src/routes/api/public/gateway/register.ts`**: Pass through the new schema to the function.

### 3. Android Client
- **`ApiModels.kt`**: Update `RegisterRequest` to include `pairingCode`.
- **`PairingScreen.kt`**: Add a field for the pairing code.
- **Error Handling**: Update the UI to display the actual error message from the backend JSON response.

### 4. UI (PHIF Tracker)
- **`src/routes/settings.tsx`**: Add a "Gateway Pairing" section to show active devices and generate a new pairing code.

## Technical Details

### Security
- Pairing codes: 6 characters (A-Z, 0-9), 10-minute expiry, single-use.
- Token storage: Only the SHA-256 hash of the `deviceToken` is stored in the database.
- RLS: Ensure `gateway_devices` can only be queried by the authorized pharmacy via the hash-matching logic in `claimSmsJobs`.

### Mismatch Audit
- **Android Request**: `{ "name": "..." }`
- **Backend Expects**: `{ "name": "..." }` but requires Cookie header with `phif_session`.
- **Root Cause**: Non-browser environment (Android Retrofit) cannot provide web session cookies.
- **Fix**: Decouple registration from session via temporary pairing codes.
