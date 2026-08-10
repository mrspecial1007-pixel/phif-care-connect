DROP VIEW IF EXISTS public.v_patient_status;
CREATE VIEW public.v_patient_status WITH (security_invoker = true) AS
WITH latest_tx AS (
  SELECT DISTINCT ON (dt.patient_id) dt.patient_id, dt.pharmacy_id, dt.dispensing_date
  FROM dispensing_transactions dt
  WHERE dt.is_cancelled = false OR dt.is_cancelled IS NULL
  ORDER BY dt.patient_id, dt.dispensing_date DESC, dt.created_at DESC
), track_agg AS (
  SELECT t.patient_id,
    jsonb_agg(jsonb_build_object(
      'id', t.id,
      'next_due_date', t.next_due_date,
      'last_dispensing_date', t.last_dispensing_date,
      'status', t.status,
      'remaining_days', (t.next_due_date - CURRENT_DATE)
    ) ORDER BY t.next_due_date) AS tracks,
    count(*) AS active_tracks_count,
    min(t.next_due_date) AS next_due_date
  FROM dispensing_due_tracks t
  WHERE t.status = 'Waiting'::cycle_status
  GROUP BY t.patient_id
), pharmacy_stats AS (
  SELECT dt.patient_id, count(DISTINCT dt.pharmacy_id) AS pharmacy_count
  FROM dispensing_transactions dt
  WHERE dt.is_cancelled = false OR dt.is_cancelled IS NULL
  GROUP BY dt.patient_id
)
SELECT p.id AS patient_id,
  p.patient_name,
  p.insurance_card_number,
  p.national_id,
  p.phone,
  p.address,
  p.is_favorite,
  p.is_archived,
  p.review_status,
  p.is_follow_up_suspended,
  p.follow_up_suspension_reason,
  lt.pharmacy_id AS last_pharmacy_id,
  ph.name AS last_pharmacy_name,
  lt.dispensing_date AS last_dispensing_date,
  ta.next_due_date,
  COALESCE(ta.active_tracks_count, 0) AS active_tracks_count,
  ta.tracks,
  ps.pharmacy_count,
  CASE WHEN ps.pharmacy_count > 1 THEN true ELSE false END AS is_shared,
  CASE WHEN ta.next_due_date IS NOT NULL
    THEN (ta.next_due_date - CURRENT_DATE)::integer
    ELSE NULL::integer END AS remaining_days
FROM patients p
LEFT JOIN latest_tx lt ON p.id = lt.patient_id
LEFT JOIN pharmacies ph ON lt.pharmacy_id = ph.id
LEFT JOIN track_agg ta ON p.id = ta.patient_id
LEFT JOIN pharmacy_stats ps ON p.id = ps.patient_id
WHERE p.is_archived = false OR p.is_archived IS NULL;

GRANT SELECT ON public.v_patient_status TO anon, authenticated, service_role;