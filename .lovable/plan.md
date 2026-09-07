# P1 — Medication Identity & Prescription Foundation (design only)

## What exists today (verified)

- Tables: `patients`, `pharmacies`, `dispensing_transactions`, `dispensing_due_tracks`, `dispensing_cycles`, `communication_logs`, `audit_log`, `sms_messages`, `sms_send_attempts`, `gateway_devices`, `gateway_pairing_codes`.
- No medication, product, prescription, mapping, or PHIF table exists. Nothing to migrate or backfill.
- `patients` is globally shared identity; pharmacy relation is indirect through `dispensing_transactions.pharmacy_id`.
- Reads are server-only (`requirePharmacySession()` + admin client, `SERVED_BY` predicate); anonymous access is revoked. Extensions available: `pgcrypto`, `uuid-ossp` (no `pg_trgm`, no `unaccent`).

Nothing below touches dispensing logic, due tracks, cycles, PHIF, claims, SMS, or notifications.

## Proposed tables

### 1. `medications` — therapeutic identity (global, shared reference)
Fields: `active_ingredient` (raw, as entered), `active_ingredient_normalized`, `strength_value` numeric, `strength_unit` text, `strength_denominator_value` numeric null, `strength_denominator_unit` text null (for `5 mg/5 mL` forms), `dosage_form` text, `route` text null, `atc_code` text null, `notes`.

Identity rule (uniqueness):
`UNIQUE (active_ingredient_normalized, strength_value, strength_unit, coalesce(strength_denominator_value,0), coalesce(strength_denominator_unit,''), dosage_form)`

- Different strengths are structurally different rows — no fuzzy or automatic matching anywhere.
- Brand, manufacturer, supplier, price, package size are **not** columns here.
- Normalization is deterministic (lowercase, Arabic letter unification, diacritics stripped, whitespace collapsed) and stored, never recomputed at read time.

### 2. `commercial_products` — what is actually bought/stocked (global catalogue)
Fields: `brand_name`, `brand_name_normalized`, `manufacturer`, `supplier` null, `package_size` numeric null, `package_unit` null, `barcode` null, `phif_code` null, `is_active`.
- No FK to `medications`. Products deliberately do not carry therapeutic identity.
- `UNIQUE (barcode)` where barcode not null; `UNIQUE (brand_name_normalized, manufacturer, package_size, package_unit)` as a soft dedupe key.

### 3. `product_medication_mappings` — reusable, versioned link
Fields: `product_id` → `commercial_products`, `medication_id` → `medications`, `units_per_package` numeric null, `source` text (`manual` | `phif` | `import`), `confidence` text (`confirmed` | `proposed`), `effective_from` timestamptz default now(), `effective_to` timestamptz null, `created_by_pharmacy_id` null.
- Partial unique: one active mapping per product — `UNIQUE (product_id) WHERE effective_to IS NULL AND confidence = 'confirmed'`.
- Corrections close the current row (`effective_to`) and insert a new one; historical rows are never edited or deleted, so past records keep the mapping that was true at the time.
- Combination products are supported by allowing several medication rows per product with distinct `medication_id` — enforced by `UNIQUE (product_id, medication_id, effective_from)`.

### 4. `prescriptions` — pharmacy-private
Fields: `pharmacy_id` (NOT NULL, FK), `patient_id` (FK), `prescription_date`, `prescriber_name` null, `source` (`paper` | `phif` | `manual`), `external_ref` null, `status` (`draft` | `active` | `completed` | `cancelled`), `notes`.
- `UNIQUE (pharmacy_id, external_ref)` where `external_ref` not null (idempotent future PHIF import).
- Index on `(pharmacy_id, patient_id, prescription_date desc)`.

### 5. `prescription_items` — pharmacy-private through parent
Fields: `prescription_id` (FK, cascade), `pharmacy_id` (denormalized NOT NULL for direct isolation), `medication_id` (FK, nullable while drafting an unmatched line), `raw_text` (what was written on the prescription), `quantity_prescribed` numeric null, `quantity_unit` null, `dose_instructions` null, `days_supply` int null, `line_number` int.
- `UNIQUE (prescription_id, line_number)`.
- No dispensed/remaining columns — fulfilment is P2, not here.

All five get `created_at`/`updated_at` with the existing `tg_touch_updated_at` trigger.

## Pharmacy isolation / RLS model

Consistent with P0: the browser reads nothing directly; all access is via server functions holding a pharmacy session.

| Table | Class | Grants | RLS |
|---|---|---|---|
| `medications` | shared reference | `service_role` only | enabled, no policy |
| `commercial_products` | shared reference | `service_role` only | enabled, no policy |
| `product_medication_mappings` | shared reference | `service_role` only | enabled, no policy |
| `prescriptions` | pharmacy-private | `service_role` only | enabled, no policy |
| `prescription_items` | pharmacy-private | `service_role` only | enabled, no policy |

No `anon` or `authenticated` grants — matching the post-P0 lockdown. Isolation is enforced in server functions: every prescription read/write filters `pharmacy_id = session.pharmacy_id`, and patient access still goes through `SERVED_BY`. Unauthorized lookups return not_found.

Reference tables are readable across pharmacies by design (a drug identity is not commercial information), but they carry no patient, price, or operational data.

## Safety

- Additive only: five new tables, no ALTER of any existing table, no data written.
- No historical medication data is fabricated; prescriptions exist only once a pharmacy enters them.
- Existing patients, transactions, tracks, and every current screen keep working untouched.
- Rollback is a plain `DROP TABLE` of the five new tables in reverse dependency order.

## Open questions for you

1. Should the medication catalogue start empty (pharmacies add as they go), or do you have a real PHIF/medication list to seed from?
2. Do prescriptions need an expiry/validity period field now, or later with fulfilment?

Awaiting your review — no migration will run until you approve this model.
