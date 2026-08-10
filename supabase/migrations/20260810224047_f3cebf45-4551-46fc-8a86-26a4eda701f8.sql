-- 1. Add follow-up suspension fields to patients table
ALTER TABLE public.patients 
ADD COLUMN IF NOT EXISTS is_follow_up_suspended BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS follow_up_suspended_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS follow_up_suspension_reason TEXT;

-- 2. Update v_patient_status view
-- We need to drop and recreate it because we're adding columns and potentially changing logic
DROP VIEW IF EXISTS public.v_patient_status;

CREATE VIEW public.v_patient_status WITH (security_invoker = true) AS
WITH latest_tx AS (
    SELECT DISTINCT ON (patient_id)
        patient_id,
        pharmacy_id,
        dispensing_date
    FROM public.dispensing_transactions
    WHERE is_cancelled = false OR is_cancelled IS NULL
    ORDER BY patient_id, dispensing_date DESC, created_at DESC
),
track_agg AS (
    SELECT 
        patient_id,
        jsonb_agg(jsonb_build_object(
            'id', id,
            'next_due_date', next_due_date,
            'last_dispensing_date', last_dispensing_date,
            'status', status
        ) ORDER BY next_due_date ASC) as tracks,
        COUNT(*) as active_tracks_count,
        MIN(next_due_date) as next_due_date
    FROM public.dispensing_due_tracks
    WHERE status = 'Waiting'
    GROUP BY patient_id
),
pharmacy_stats AS (
    SELECT 
        patient_id,
        COUNT(DISTINCT pharmacy_id) as pharmacy_count
    FROM public.dispensing_transactions
    WHERE is_cancelled = false OR is_cancelled IS NULL
    GROUP BY patient_id
)
SELECT 
    p.id as patient_id,
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
    lt.pharmacy_id as last_pharmacy_id,
    ph.name as last_pharmacy_name,
    lt.dispensing_date as last_dispensing_date,
    ta.next_due_date,
    ta.active_tracks_count,
    ta.tracks,
    ps.pharmacy_count,
    CASE 
        WHEN ps.pharmacy_count > 1 THEN true 
        ELSE false 
    END as is_shared,
    CASE 
        WHEN ta.next_due_date IS NOT NULL THEN 
            EXTRACT(DAY FROM (ta.next_due_date::timestamp - CURRENT_DATE::timestamp))::integer
        ELSE NULL
    END as remaining_days
FROM public.patients p
LEFT JOIN latest_tx lt ON p.id = lt.patient_id
LEFT JOIN public.pharmacies ph ON lt.pharmacy_id = ph.id
LEFT JOIN track_agg ta ON p.id = ta.patient_id
LEFT JOIN pharmacy_stats ps ON p.id = ps.patient_id
WHERE (p.is_archived = false OR p.is_archived IS NULL);

GRANT SELECT ON public.v_patient_status TO authenticated;
GRANT SELECT ON public.v_patient_status TO anon;
