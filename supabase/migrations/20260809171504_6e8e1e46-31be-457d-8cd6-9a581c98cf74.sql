-- Drop and recreate v_patient_status to avoid column name change error
DROP VIEW IF EXISTS public.v_patient_status;

CREATE OR REPLACE VIEW public.v_patient_status AS
 WITH track_stats AS (
         SELECT dispensing_due_tracks.patient_id,
            min(dispensing_due_tracks.next_due_date) AS nearest_due_date,
            count(*) AS active_tracks_count,
            jsonb_agg(
                jsonb_build_object(
                    'next_due_date', dispensing_due_tracks.next_due_date,
                    'remaining_days', dispensing_due_tracks.next_due_date - CURRENT_DATE
                ) ORDER BY dispensing_due_tracks.next_due_date ASC
            ) AS tracks
           FROM dispensing_due_tracks
          WHERE dispensing_due_tracks.status <> 'Completed'::cycle_status
          GROUP BY dispensing_due_tracks.patient_id
        ), last_tx AS (
         SELECT DISTINCT ON (dispensing_transactions.patient_id) dispensing_transactions.patient_id,
            dispensing_transactions.pharmacy_id,
            dispensing_transactions.dispensing_date
           FROM dispensing_transactions
          ORDER BY dispensing_transactions.patient_id, dispensing_transactions.dispensing_date DESC
        ), shared AS (
         SELECT dispensing_transactions.patient_id,
            count(DISTINCT dispensing_transactions.pharmacy_id) AS pharmacy_count
           FROM dispensing_transactions
          GROUP BY dispensing_transactions.patient_id
        )
 SELECT p.id AS patient_id,
    p.patient_name,
    p.insurance_card_number,
    p.national_id,
    p.phone,
    p.review_status,
    p.is_favorite,
    ts.nearest_due_date AS next_due_date,
        CASE
            WHEN ts.nearest_due_date IS NULL THEN NULL::integer
            ELSE ts.nearest_due_date - CURRENT_DATE
        END AS remaining_days,
    ts.active_tracks_count,
    COALESCE(ts.tracks, '[]'::jsonb) AS tracks,
    lt.pharmacy_id AS last_pharmacy_id,
    lp.name AS last_pharmacy_name,
    lt.dispensing_date AS last_dispensing_date,
    COALESCE(s.pharmacy_count, 0::bigint) AS pharmacy_count,
    COALESCE(s.pharmacy_count, 0::bigint) >= 2 AS is_shared
   FROM patients p
     LEFT JOIN track_stats ts ON ts.patient_id = p.id
     LEFT JOIN last_tx lt ON lt.patient_id = p.id
     LEFT JOIN pharmacies lp ON lp.id = lt.pharmacy_id
     LEFT JOIN shared s ON s.patient_id = p.id;

-- Ensure view is accessible
ALTER VIEW public.v_patient_status SET (security_invoker = on);
GRANT SELECT ON public.v_patient_status TO authenticated;
GRANT SELECT ON public.v_patient_status TO anon;
