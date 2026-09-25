-- PHIF Tracker: keep historical insurance card numbers per patient.
-- Additive only. Does not modify PHIF invoice snapshots, dispensing
-- transactions, due tracks, cycles, or existing patient card values.

CREATE TABLE IF NOT EXISTS public.patient_insurance_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  card_number text NOT NULL,
  status text NOT NULL DEFAULT 'current',
  source text NOT NULL DEFAULT 'manual',
  linked_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_insurance_cards_number_not_blank CHECK (length(btrim(card_number)) > 0),
  CONSTRAINT patient_insurance_cards_status_valid CHECK (status IN ('current','previous')),
  CONSTRAINT patient_insurance_cards_source_valid CHECK (source IN ('manual','phif_review','import','migration'))
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_insurance_cards_card_number_uidx
  ON public.patient_insurance_cards (card_number);

CREATE UNIQUE INDEX IF NOT EXISTS patient_insurance_cards_one_current_uidx
  ON public.patient_insurance_cards (patient_id)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS patient_insurance_cards_patient_idx
  ON public.patient_insurance_cards (patient_id, status);

INSERT INTO public.patient_insurance_cards (patient_id, card_number, status, source)
SELECT p.id, p.insurance_card_number, 'current', 'migration'
FROM public.patients p
WHERE p.insurance_card_number IS NOT NULL
  AND length(btrim(p.insurance_card_number)) > 0
ON CONFLICT (card_number) DO NOTHING;

GRANT ALL ON public.patient_insurance_cards TO service_role;
ALTER TABLE public.patient_insurance_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_insurance_cards FROM anon, authenticated;
