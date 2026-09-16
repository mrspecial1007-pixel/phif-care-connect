DROP VIEW IF EXISTS public.v_patient_status;

CREATE VIEW public.v_patient_status
WITH (security_invoker = true) AS
WITH open_cycle AS (
  SELECT DISTINCT ON (patient_id)
    id,
    patient_id,
    status,
    started_at,
    next_due_date,
    created_at
  FROM public.dispensing_cycles
  WHERE status <> 'Completed'::public.cycle_status
  ORDER BY patient_id, started_at DESC, created_at DESC
),
active_tracks AS (
  SELECT
    patient_id,
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'last_dispensing_date', last_dispensing_date,
        'next_due_date', next_due_date,
        'remaining_days', next_due_date - CURRENT_DATE,
        'status', status
      )
      ORDER BY next_due_date
    ) AS tracks,
    count(*) AS active_tracks_count,
    min(next_due_date) AS next_due_date
  FROM public.dispensing_due_tracks
  WHERE status = 'Waiting'::public.cycle_status
  GROUP BY patient_id
),
last_tx AS (
  SELECT DISTINCT ON (tx.patient_id)
    tx.patient_id,
    tx.pharmacy_id,
    ph.name AS pharmacy_name,
    tx.dispensing_date
  FROM public.dispensing_transactions tx
  JOIN public.pharmacies ph ON ph.id = tx.pharmacy_id
  WHERE COALESCE(tx.is_cancelled, false) = false
  ORDER BY tx.patient_id, tx.dispensing_date DESC, tx.created_at DESC
),
shared AS (
  SELECT
    patient_id,
    count(DISTINCT pharmacy_id) AS pharmacy_count
  FROM public.dispensing_transactions
  WHERE COALESCE(is_cancelled, false) = false
  GROUP BY patient_id
)
SELECT
  p.id,
  p.id AS patient_id,
  p.patient_name,
  p.patient_name_normalized,
  p.insurance_card_number,
  p.national_id,
  p.phone,
  p.address,
  p.birth_date,
  p.gender,
  p.notes,
  p.review_status,
  COALESCE(p.is_favorite, false) AS is_favorite,
  COALESCE(p.is_archived, false) AS is_archived,
  COALESCE(p.is_follow_up_suspended, false) AS is_follow_up_suspended,
  p.follow_up_suspended_at,
  p.follow_up_suspension_reason,
  oc.id AS current_cycle_id,
  oc.status AS current_cycle_status,
  oc.started_at AS current_cycle_started_at,
  COALESCE(at.next_due_date, oc.next_due_date) AS next_due_date,
  CASE
    WHEN COALESCE(at.next_due_date, oc.next_due_date) IS NULL THEN NULL
    ELSE COALESCE(at.next_due_date, oc.next_due_date) - CURRENT_DATE
  END AS remaining_days,
  COALESCE(at.tracks, '[]'::jsonb) AS tracks,
  COALESCE(at.active_tracks_count, 0) AS active_tracks_count,
  lt.dispensing_date AS last_dispensing_date,
  lt.pharmacy_id AS last_pharmacy_id,
  lt.pharmacy_name AS last_pharmacy_name,
  COALESCE(s.pharmacy_count, 0) AS pharmacy_count,
  COALESCE(s.pharmacy_count, 0) >= 2 AS is_shared
FROM public.patients p
LEFT JOIN open_cycle oc ON oc.patient_id = p.id
LEFT JOIN active_tracks at ON at.patient_id = p.id
LEFT JOIN last_tx lt ON lt.patient_id = p.id
LEFT JOIN shared s ON s.patient_id = p.id;

GRANT SELECT ON public.v_patient_status TO authenticated, service_role;
