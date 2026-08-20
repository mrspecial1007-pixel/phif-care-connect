# SMS Gateway Secure Pairing Plan (Revised)

Implementing a code-based activation flow for the SMS Gateway to decouple registration from browser session cookies while strictly enforcing pharmacy isolation and token security.

## 1. Database Schema Changes
- **`gateway_pairing_codes`**:
    - `id` (UUID, PK)
    - `pharmacy_id` (UUID, FK)
    - `code_hash` (TEXT, unique) - SHA-256 of the 6-char pairing code.
    - `expires_at` (TIMESTAMPTZ)
    - `used_at` (TIMESTAMPTZ, nullable)
- **`gateway_devices`**:
    - Add `revoked_at` (TIMESTAMPTZ, nullable) for immediate invalidation.

## 2. Backend Implementation (TanStack Start / Supabase)
- **`src/lib/sms-gateway.functions.ts`**:
    - `generatePairingCode`: (Authenticated) Generates a 6-char CSPRNG code, hashes it, and stores it. Returns the plaintext code once.
    - `registerGatewayDevice`: (Public) 
        - Atomically verifies the `pairingCode` hash.
        - Checks expiry and `used_at` is null.
        - Marks `used_at = now()`.
        - Inserts into `gateway_devices` linked to the pharmacy from the pairing code record.
        - Returns `{ deviceId, deviceToken }`.
    - `revokeGatewayDevice`: (Authenticated) Sets `revoked_at` for a device.
- **Middleware**: Ensure `claimSmsJobs` and `updateSmsStatus` reject devices where `revoked_at` is not null.

## 3. UI Implementation (PHIF Tracker)
- **`src/routes/settings.tsx`**: 
    - New "SMS Gateway" section.
    - Button to generate pairing code (shows code + countdown).
    - List of paired devices with "Revoke" button and "Last Seen" status.

## 4. Android Gateway Implementation
- **`RegisterRequest`**: Update to include `pairingCode`.
- **`PairingScreen.kt`**: Add Pairing Code input field with normalization (trim + uppercase).
- **Error Handling**: Improved error parsing to show backend-returned Arabic error messages.

## 5. Security Invariants
- **Atomic Registration**: Using a Postgres function or conditional update to ensure single-use pairing codes.
- **Isolations**: Pharmacy ID is never passed by the client; it's derived from the pairing code.
- **Hashing**: All tokens and codes stored only as hashes.

## 6. Verification Plan
- Unit tests for pairing code expiry and single-use.
- Integration test for registration without cookies.
- Revocation test ensuring immediate job rejection.
