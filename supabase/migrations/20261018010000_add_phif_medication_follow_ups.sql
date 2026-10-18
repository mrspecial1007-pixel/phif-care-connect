-- Per-patient follow-up only. Does not change imported PHIF or dispensing data.
BEGIN;
CREATE TABLE public.phif_medication_follow_ups (
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  patient_id uuid NOT NULL REFERENCES public.patients(id),
  medication_identity_key text NOT NULL,
  is_stopped boolean NOT NULL DEFAULT false,
  reason text,
  stopped_at timestamptz,
  reactivated_at timestamptz,
  baseline_invoice_ids uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, patient_id, medication_identity_key),
  CONSTRAINT phif_medication_follow_ups_identity_valid CHECK (length(btrim(medication_identity_key)) BETWEEN 1 AND 2000),
  CONSTRAINT phif_medication_follow_ups_reason_valid CHECK (
    NOT is_stopped OR (reason IS NOT NULL AND length(btrim(reason)) BETWEEN 1 AND 500 AND stopped_at IS NOT NULL)
  )
);

ALTER TABLE public.phif_medication_follow_ups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_medication_follow_ups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.phif_medication_follow_ups TO service_role;

-- Server-authorized, atomic and idempotent: a repeated stop preserves its date
-- and baseline so a newly imported invoice cannot clear the review warning.
CREATE FUNCTION public.set_phif_medication_follow_up(
  p_pharmacy_id uuid, p_patient_id uuid, p_identity_key text,
  p_is_stopped boolean, p_reason text, p_invoice_ids uuid[]
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_pharmacy_access a
    JOIN public.pharmacies p ON p.id = a.pharmacy_id
    WHERE a.pharmacy_id = p_pharmacy_id AND a.patient_id = p_patient_id
      AND p.name = 'صيدلية الترياق الشافي'
  ) THEN
    RAISE EXCEPTION 'Patient access denied';
  END IF;
  INSERT INTO public.phif_medication_follow_ups AS f (
    pharmacy_id, patient_id, medication_identity_key, is_stopped,
    reason, stopped_at, reactivated_at, baseline_invoice_ids
  ) VALUES (
    p_pharmacy_id, p_patient_id, p_identity_key, p_is_stopped,
    CASE WHEN p_is_stopped THEN btrim(p_reason) END,
    CASE WHEN p_is_stopped THEN now() END,
    CASE WHEN NOT p_is_stopped THEN now() END,
    COALESCE(p_invoice_ids, '{}'::uuid[])
  )
  ON CONFLICT (pharmacy_id, patient_id, medication_identity_key) DO UPDATE SET
    is_stopped = EXCLUDED.is_stopped,
    reason = CASE WHEN EXCLUDED.is_stopped THEN EXCLUDED.reason ELSE f.reason END,
    stopped_at = CASE WHEN EXCLUDED.is_stopped THEN EXCLUDED.stopped_at ELSE f.stopped_at END,
    reactivated_at = CASE WHEN NOT EXCLUDED.is_stopped THEN now() ELSE f.reactivated_at END,
    baseline_invoice_ids = CASE WHEN EXCLUDED.is_stopped THEN EXCLUDED.baseline_invoice_ids ELSE f.baseline_invoice_ids END,
    updated_at = now()
  WHERE f.is_stopped IS DISTINCT FROM EXCLUDED.is_stopped;
END;
$$;
REVOKE ALL ON FUNCTION public.set_phif_medication_follow_up(uuid, uuid, text, boolean, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_medication_follow_up(uuid, uuid, text, boolean, text, uuid[]) TO service_role;
COMMIT;
