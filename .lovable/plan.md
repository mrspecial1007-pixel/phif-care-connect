# Audit & Implementation Plan: SMS Gateway Integration

## Audit of Existing System

### 1. Project Architecture
- **Framework**: TanStack Start v1 (React 19 + Vite 7).
- **Backend**: Supabase (PostgreSQL + RLS).
- **Auth**: Pharmacy-based session (shared PIN) stored in encrypted cookies.
- **Styling**: Tailwind CSS v4, Arabic RTL support with Cairo font.

### 2. Existing Communication Logic
- **Component**: `src/components/PhoneSheet.tsx`.
- **Behavior**: Generates message templates based on patient status (overdue, due, etc.) and launches external protocols (`sms:`, `wa.me:`, `tel:`).
- **Logging**: Uses `communication_logs` to record when a user *clicks* a communication button. It does not store message content or track delivery.
- **Normalization**: `normalizeLibyaIntl` handles Libyan phone number formatting (+218).

### 3. Database State
- `communication_logs`: Tracks metadata (patient, pharmacy, channel, status, days).
- `audit_log`: Tracks data mutations (dispensing, edits).
- No message queue or status tracking for asynchronous tasks.

---

## Implementation Plan

### 1. Data Model (Supabase)
We will create new tables to separate logical messages from physical attempts.

**`public.sms_messages`** (Logical message)
- `id`: UUID (Primary Key)
- `patient_id`: UUID (References patients)
- `pharmacy_id`: UUID (References pharmacies)
- `phone_number`: TEXT
- `message_body`: TEXT
- `idempotency_key`: TEXT
- `current_status`: `sms_status` (Enum: `pending`, `sending`, `sent`, `delivered`, `failed`, `cancelled`)
- `created_at`: TIMESTAMPTZ
- `created_by`: UUID (Pharmacy ID)
- **Constraint**: `UNIQUE (pharmacy_id, idempotency_key)`

**`public.sms_send_attempts`** (Physical SIM attempts)
- `id`: UUID (Primary Key)
- `message_id`: UUID (References sms_messages)
- `attempt_number`: INT
- `gateway_device_id`: UUID (References gateway_devices)
- `sim_slot`: INT
- `requested_at`: TIMESTAMPTZ
- `claimed_at`: TIMESTAMPTZ (Job claim timestamp)
- `lease_expires_at`: TIMESTAMPTZ (Lease expiration)
- `sent_at`: TIMESTAMPTZ
- `delivered_at`: TIMESTAMPTZ
- `failed_at`: TIMESTAMPTZ
- `error_code`: TEXT
- `error_message`: TEXT

**`public.gateway_devices`** (Authorized hardware)
- `id`: UUID
- `name`: TEXT
- `pharmacy_id`: UUID
- `token_hash`: TEXT (Securely hashed device token)
- `fcm_token`: TEXT (Wake-up signal token)
- `status`: TEXT
- `last_seen_at`: TIMESTAMPTZ
- `enabled`: BOOLEAN (Default: true)

---

### 2. API Contract & Hardened Logic

#### App -> Backend (`src/lib/sms.functions.ts`)
- `sendSmsRequest(data: { patientId, body, idempotencyKey })`: 
    - Validates pharmacy session.
    - **Backend Idempotency**: `INSERT ... ON CONFLICT (pharmacy_id, idempotency_key) DO UPDATE SET pharmacy_id = EXCLUDED.pharmacy_id RETURNING *`.
    - Returns existing or new `message_id`.

#### Gateway -> Backend (`src/routes/api/public/gateway/*`)
- **`POST /gateway/register`**: Pairs device. Generates `device_token` (returned once), stores `sha256(token)`.
- **`GET /gateway/jobs`**: 
    - **Claim/Lease Logic**: Atomically finds `pending` messages OR `sending` messages with `lease_expires_at < NOW()`.
    - Updates status to `sending`, sets `claimed_by_device_id`, `claimed_at`, and `lease_expires_at` (e.g., +5 mins).
    - Returns job details.
- **`POST /gateway/jobs/:id/status`**: Updates attempt status and resolves the logical message state.

**Security**: 
- `X-Gateway-Token` is verified against `token_hash`.
- Revocation: Setting `enabled = false` immediately rejects all API calls for that device.

---

### 3. Revised Gateway Communication Architecture: Wake-only FCM

1. **Trigger**: Backend sends a high-priority "wake" signal via FCM. **FCM delivery does not change message state.**
2. **Action**: Gateway background listener receives FCM, calls `GET /gateway/jobs` to **claim** the job.
3. **Recovery**: WorkManager periodically (e.g., every hour) calls `GET /gateway/jobs` to catch missed signals or jobs with expired leases.
4. **Lease Handling**: If a Gateway claims a job but fails to report back within 5 minutes, the next `GET /gateway/jobs` call (from any device in the pharmacy) will re-claim it.

#### Architecture Comparison for Dedicated Gateway Phone:

| Mechanism | Latency | Battery/Reliability | Android Suitability |
| :--- | :--- | :--- | :--- |
| **Option A: FCM Wake + Pull** | Low (seconds) | High (System-level) | Recommended (Doze-safe). |
| **Option B: Foreground Service** | Near Zero | Medium (Persistent) | Reliable on dedicated phones. |
| **Option C: WorkManager** | High (15min min) | High | **Recovery Fallback Only.** |

---

### 4. Phase 1 Implementation Scope

#### Database (Supabase Migration)
- `sms_status` Enum.
- `sms_messages` & `sms_send_attempts` tables with RLS and Grants.
- `gateway_devices` table with `token_hash` and `fcm_token`.
- Unique constraint on `(pharmacy_id, idempotency_key)`.

#### Backend (Server Functions & API)
- `sendSmsRequest`: Handles pharmacy session and backend idempotency.
- `GET /api/public/gateway/jobs`: Implements the **atomic claim/lease** logic.
- `POST /api/public/gateway/status`: Processes updates from the Gateway.
- `POST /api/public/gateway/register`: Secure device pairing with token hashing.

#### UI Changes
- **SMS Preview (`PhoneSheet.tsx`)**: Character count, segments (GSM-7 vs Unicode), and backend-only dispatch.
- **Messages History**: A new route to search and filter messages, with status badges.
- **Audit**: Log all manual SMS creations and status updates in `audit_log`.

---

### 4. Idempotency & Lifecycle
- **Idempotency**: The Frontend generates a unique `idempotencyKey` when opening the preview. If the request is retried (network error), the Backend checks the key and returns the existing message rather than creating a duplicate.
- **Sent vs Delivered**: 
    - `sent`: Android confirmed `SmsManager` success.
    - `delivered`: Android `DELIVERY_INTENT` received from carrier.
    - If the carrier doesn't support reports, the message stays `sent` (Success).

---

### 5. UI Changes

#### Phase 1 (App & Backend)
1. **SMS Preview**: Update `PhoneSheet.tsx` to:
    - Show character count and SMS segments (GSM-7/Unicode logic).
    - "Send" button calls `sendSmsRequest`.
    - Shows "Request queued" toast.
2. **Messages Dashboard**: 
    - New route `/messages` to view history.
    - Status badges (colored by state).
    - "Retry" button for failed messages.

#### Phase 2 (Android Gateway - Later)
1. **Background Service**: Android app with `SmsManager`.
2. **Registration UI**: To pair the phone with a pharmacy.
3. **Log View**: Local record of messages handled.

---

## Implementation Split

### Phase 1: Current PHIF App + Backend
- Database migrations (Tables, RLS, Enums).
- Server functions for SMS creation.
- Updated `PhoneSheet.tsx` UI with character counting.
- Messages management page.
- Public API stubs for Gateway polling.

### Phase 2: Android SMS Gateway
- Separate Android project (Kotlin/Java).
- Implementation of the API Contract.
- Battery/Background optimization settings.

### Phase 3: Integration
- End-to-End testing with real SIM.
- Delivery report verification.
