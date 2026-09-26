-- PHIF Tracker: explicit patient/pharmacy relationship.
-- Additive only. This keeps one global patient identity while making pharmacy
-- visibility an explicit relationship instead of inferring it only from
-- dispensing history.

CREATE TABLE IF NOT EXISTS public.patient_pharmacy_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_pharmacy_access_source_valid CHECK (source IN ('manual','dispensing_history','phif_review','phif_invoice'))
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_pharmacy_access_patient_pharmacy_uidx
  ON public.patient_pharmacy_access (patient_id, pharmacy_id);

CREATE INDEX IF NOT EXISTS patient_pharmacy_access_pharmacy_patient_idx
  ON public.patient_pharmacy_access (pharmacy_id, patient_id);

-- Confirmed manual origin: patients created through server-side patient forms
-- write an audit_log row with the session pharmacy. This preserves existing
-- manually created patients that have not yet received a dispensing
-- transaction or PHIF invoice.
INSERT INTO public.patient_pharmacy_access (patient_id, pharmacy_id, source)
SELECT DISTINCT al.entity_id, al.pharmacy_id, 'manual'
FROM public.audit_log al
JOIN public.patients p ON p.id = al.entity_id
WHERE al.entity = 'patient'
  AND al.action = 'create_patient'
  AND al.entity_id IS NOT NULL
  AND al.pharmacy_id IS NOT NULL
ON CONFLICT (patient_id, pharmacy_id) DO NOTHING;

INSERT INTO public.patient_pharmacy_access (patient_id, pharmacy_id, source)
SELECT DISTINCT dt.patient_id, dt.pharmacy_id, 'dispensing_history'
FROM public.dispensing_transactions dt
WHERE dt.patient_id IS NOT NULL
  AND dt.pharmacy_id IS NOT NULL
ON CONFLICT (patient_id, pharmacy_id) DO NOTHING;

INSERT INTO public.patient_pharmacy_access (patient_id, pharmacy_id, source)
SELECT DISTINCT pi.patient_id, pi.pharmacy_id, 'phif_invoice'
FROM public.phif_invoices pi
WHERE pi.patient_id IS NOT NULL
  AND pi.pharmacy_id IS NOT NULL
ON CONFLICT (patient_id, pharmacy_id) DO NOTHING;

-- Review helper for production rollout. These patients have no confirmed
-- pharmacy relationship from audit_log, dispensing history, or PHIF invoices.
-- Do not auto-link them to any pharmacy without manual verification.
CREATE OR REPLACE VIEW public.v_patient_pharmacy_access_unassigned AS
SELECT
  p.id AS patient_id,
  p.patient_name,
  p.insurance_card_number,
  p.created_at
FROM public.patients p
WHERE NOT EXISTS (
  SELECT 1
  FROM public.patient_pharmacy_access ppa
  WHERE ppa.patient_id = p.id
);

GRANT ALL ON public.patient_pharmacy_access TO service_role;
ALTER TABLE public.patient_pharmacy_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_pharmacy_access FROM anon, authenticated;

GRANT SELECT ON public.v_patient_pharmacy_access_unassigned TO service_role;
REVOKE ALL ON public.v_patient_pharmacy_access_unassigned FROM anon, authenticated;
