# PHIF Tracker – Plan (v2)

Mobile-first Arabic RTL PWA for pharmacists to track PHIF insurance patients, 28-day dispensing cycles, partial dispensing, and patients shared between صيدلية الترياق الشافي and صيدلية الأندلس (extensible to more pharmacies).

## Scope decisions
- **Auth:** shared PIN per pharmacy (no per-user login).
- **Seed:** import your two readable Excel files as initial DB. (The third file "دمج…المكررين.xlsx" is corrupted and cannot be opened; the two source files contain all rows and I'll merge them.)
- **PWA:** installable, online-required.
- **Shared match:** insurance_card_number only.

## Deduplication rules (corrected)
- **Primary key for matching:** `insurance_card_number`. Same card # = same patient (upsert, keep newest name/date, append history).
- **Missing card #:** never auto-merge. Normalize the name (trim, collapse spaces, strip tatweel/diacritics, unify alef/yaa) and compare against existing records without card #. If a normalized-name match is found, insert as a **new** patient with `status = 'needs_review'` and a `possible_duplicate_of` pointer to the candidate. Show a "بحاجة للمراجعة" queue in the app where a pharmacist can Merge or Keep Separate.
- Never merge across different card numbers automatically, even if names match.

## Security model (corrected)
- **All writes go through server functions only.** No client-side inserts/updates/deletes on any table.
- Client uses the Supabase publishable key for **read-only** queries on non-sensitive views, gated by narrow `TO anon` SELECT policies. All mutating tables (`patients`, `dispensing_cycles`, `dispensing_transactions`, `pharmacies`, `audit_log`) get **no `TO anon` INSERT/UPDATE/DELETE policies**.
- Server functions (`createServerFn`) validate every input with Zod, verify the caller's pharmacy PIN session (encrypted cookie via `useSession` with `SESSION_SECRET`), and write via `supabaseAdmin` inside the handler.
- **Every write server fn appends an `audit_log` row** in the same transaction: pharmacy_id, action, entity, entity_id, before/after payload, request IP, timestamp.
- PIN unlock: `unlockPharmacy` server fn — timing-safe hash comparison against stored `pin_hash` (bcrypt/scrypt), then sets encrypted session cookie `{ pharmacy_id, unlocked_at }`. All write fns call a shared `requirePharmacySession()` guard that reads the session and 401s if absent.
- Rate-limit PIN attempts per IP in the fn (in-memory bucket).
- RLS enabled on every table; policies grant `service_role` full access and `anon` only narrow safe-column SELECTs where needed.

## Design direction
- Arabic RTL (`dir="rtl"`, `lang="ar"`), Cairo font.
- Healthcare palette: white surfaces, teal primary, neutral grays; status colors gray / yellow / green / red per spec; orange border (shared) + blue border (partial).
- Large touch targets (≥48px), thumb-reach primary actions, bottom tab bar: الرئيسية / المرضى / التقارير / الاستيراد / الإعدادات.
- Cards rounded-2xl, soft shadow, subtle state-change motion.

## Screens
1. **Unlock** – pharmacy picker + PIN pad → `unlockPharmacy` server fn.
2. **Dashboard** – 7 stat cards (Total / Eligible Today / Due ≤3d / Overdue / Partial / Shared / Dispensed Today) + alerts + quick search + "بحاجة للمراجعة" count.
3. **Patients list** – instant search (name / card / phone / national ID), filter chips, virtualized list.
4. **Patient card** – card #, name, status line, last-pharmacy badge, "تم الصرف" / "صرف متبقي" button, color + border rules.
5. **Dispense dialog** – pharmacy (defaults to session), "Did the patient receive ALL medicines?" Yes/No, optional items count + notes.
6. **Patient details** – general + insurance info, current cycle status, immutable dispensing timeline.
7. **Needs Review queue** – normalized-name duplicates without card #; Merge / Keep Separate actions (server fn, audited).
8. **Add / Edit patient** – server-fn backed.
9. **Excel import** – upload, column auto-detect, preview, dedupe by card #, name-only matches go to Needs Review, summary (imported/updated/needs-review/shared/errors).
10. **Reports** – Eligible Today, Due Tomorrow, Due ≤3d, Overdue, Partial, Completed Today, Shared, Dispensed by Pharmacy, Monthly; CSV export + print.
11. **Settings** – pharmacies (add/rename), change PINs, export.

## Business rules (28-day cycle)
- Each patient has at most one open cycle (`Waiting` or `Partial`).
- **تم الصرف → Yes:** insert `Completed` tx, close cycle (completed_at=today, next_due_date=today+28), open new `Waiting` cycle starting today+28.
- **تم الصرف → No:** open `Partial` cycle if none, insert `Partial` tx; card button becomes "صرف متبقي"; no new due date.
- **صرف متبقي → Yes:** insert `Remaining`+close as `Completed`, next cycle at today+28.
- **صرف متبقي → No:** insert another `Remaining` tx; cycle stays `Partial`.
- **Status derivation:** Partial → blue border + "Waiting For Remaining Medicines". Else compare next_due_date to today: <0 Overdue (red), 0 Eligible (green), 1–3 Due Soon (yellow), >3 Gray.
- **Shared (orange border):** transactions exist from ≥2 pharmacies for same card #.
- History append-only.

## Data model (Lovable Cloud / Postgres)
- `pharmacies(id, name, pin_hash, created_at)` — seeded Teryaq + AlAndalus.
- `patients(id, patient_name, patient_name_normalized, insurance_card_number UNIQUE NULLS DISTINCT, national_id, phone, address, birth_date, gender, notes, review_status ['ok','needs_review'], possible_duplicate_of uuid null, created_at, updated_at)`.
- `dispensing_cycles(id, patient_id, status ['Waiting','Partial','Completed'], started_at, completed_at, next_due_date, created_at, updated_at)`.
- `dispensing_transactions(id, cycle_id, patient_id, pharmacy_id, dispensing_date, transaction_type ['Partial','Remaining','Completed'], items_dispensed int, notes, created_at)`.
- `audit_log(id, pharmacy_id, action, entity, entity_id, before jsonb, after jsonb, ip, created_at)`.
- View `v_patient_status` (remaining_days, current_cycle, last_pharmacy, is_shared) for fast list rendering.
- **GRANTs & RLS per rules:** `SELECT` on `patients`, `dispensing_cycles`, `dispensing_transactions`, `pharmacies(name,id)`, `v_patient_status` to `anon` (safe columns via view — `pin_hash` excluded); `ALL` to `service_role`. No `anon` write grants anywhere. `audit_log` is service_role only.

## Server functions (all writes + PIN-guarded)
- `unlockPharmacy({ pharmacy_id, pin })`
- `lockPharmacy()`
- `dispenseComplete({ patient_id, items?, notes? })`
- `dispensePartial({ patient_id, items?, notes? })`
- `dispenseRemaining({ patient_id, completed: boolean, items?, notes? })`
- `createPatient(...)`, `updatePatient({ id, ...editable })`
- `importExcelBatch({ rows[] })` — dedupe by card #; missing card # → needs_review.
- `mergePatients({ keep_id, drop_id })`, `keepSeparate({ id })`
- `changePin({ pharmacy_id, current_pin, new_pin })`
- Every write fn: Zod validate → `requirePharmacySession()` → begin tx → mutate → insert `audit_log` → commit.

## Excel import & seeding
Both source files: header row 2, columns رقم الفاتورة, رقم التأميني (card#), اسم المشترك, التاريخ, الحالة, تواريخ الصرف (pipe-separated history).

Seed migration:
1. Parse Andalus (`Sheet1`, 538 rows) → pharmacy=AlAndalus.
2. Parse Teryaq (`الأحدث فقط` 147 + `كشف المكررين` 83) → pharmacy=Teryaq.
3. Upsert patients by `insurance_card_number` (card # is present in both files, so no name-only merges expected at seed).
4. For each date in `تواريخ الصرف`, create a `Completed` transaction and a closed cycle (started_at=date−28, completed_at=date, next_due_date=date+28).
5. For the newest date per patient, open a `Waiting` cycle starting date+28.
6. Any rows with missing card # → inserted with `review_status='needs_review'`.

Post-seed import UI reuses the same server-fn pipeline for updates with preview + diff.

## Tech
- TanStack Start, Tailwind v4, shadcn/ui, TanStack Query, Zod.
- Cairo font via `<link>` in `__root.tsx`; `dir="rtl" lang="ar"` on `<html>`.
- Lovable Cloud (Supabase) — server-side writes only via `supabaseAdmin` inside `.handler()`; browser uses publishable-key client for guarded reads.
- Session: `useSession` (encrypted cookie) with `SESSION_SECRET`.
- PWA: manifest + icons (installable, no offline data).

## Milestones
1. Cloud enabled, schema migration with GRANTs/RLS, seed from your two Excel files.
2. PIN unlock + dashboard + patient list with search & filters.
3. Dispense flow (Complete/Partial/Remaining) with audit_log.
4. Patient details + timeline + Needs Review queue + Add/Edit.
5. Excel import UI (future updates).
6. Reports + CSV/print.
7. PWA manifest, icons, empty/error states, polish.

## Assumptions (say if you want changes)
- Default PINs: `1234` per pharmacy (changeable in Settings).
- App name: "PHIF Tracker".
- Reports export = CSV + print-to-PDF; real PDF library later if needed.
