-- PHIF Tracker V2 phase 2: persistent invoice-to-patient review state.
-- Additive only. Does not mutate dispensing transactions, due tracks, cycles,
-- bridge sessions, or PHIF invoice item snapshots.

ALTER TABLE public.phif_invoices
  ADD COLUMN IF NOT EXISTS patient_id uuid NULL REFERENCES public.patients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS review_note text NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;

ALTER TABLE public.phif_invoices
  DROP CONSTRAINT IF EXISTS phif_invoices_review_status_valid;

ALTER TABLE public.phif_invoices
  ADD CONSTRAINT phif_invoices_review_status_valid
  CHECK (review_status IN ('pending','linked','rejected'));

CREATE INDEX IF NOT EXISTS phif_invoices_patient_idx
  ON public.phif_invoices (patient_id)
  WHERE patient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS phif_invoices_pharmacy_review_idx
  ON public.phif_invoices (pharmacy_id, review_status, insurance_card_number);
