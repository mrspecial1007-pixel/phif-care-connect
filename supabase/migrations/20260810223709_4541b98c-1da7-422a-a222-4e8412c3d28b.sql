-- Add soft-delete fields to patients
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Add cancellation fields to dispensing_transactions
ALTER TABLE public.dispensing_transactions ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN DEFAULT false;
ALTER TABLE public.dispensing_transactions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.dispensing_transactions ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.pharmacies(id);
ALTER TABLE public.dispensing_transactions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Update v_patient_status view
DROP VIEW IF EXISTS public.v_patient_status;

CREATE OR REPLACE VIEW public.v_patient_status AS
WITH last_tx AS (
    SELECT DISTINCT ON (patient_id)
        patient_id,
        dispensing_date,
        pharmacy_id,
        (SELECT name FROM pharmacies WHERE id = pharmacy_id) as pharmacy_name
    FROM dispensing_transactions
    WHERE is_cancelled = false
    ORDER BY patient_id, dispensing_date DESC
),
active_tracks AS (
    SELECT 
        patient_id,
        jsonb_agg(
            jsonb_build_object(
                'id', id,
                'next_due_date', next_due_date,
                'last_dispensing_date', last_dispensing_date,
                'status', status
            ) ORDER BY next_due_date ASC
        ) as tracks_json,
        count(*) as tracks_count,
        min(next_due_date) as min_due_date
    FROM dispensing_due_tracks
    WHERE status = 'Waiting'
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
    p.review_status,
    p.is_archived,
    lt.dispensing_date as last_dispensing_date,
    lt.pharmacy_id as last_pharmacy_id,
    lt.pharmacy_name as last_pharmacy_name,
    at.min_due_date as next_due_date,
    CASE 
        WHEN at.min_due_date IS NULL THEN NULL
        ELSE (at.min_due_date::date - CURRENT_DATE)
    END as remaining_days,
    at.tracks_json as tracks,
    at.tracks_count as active_tracks_count,
    (SELECT count(DISTINCT pharmacy_id) FROM dispensing_transactions WHERE patient_id = p.id AND is_cancelled = false) as pharmacy_count,
    (SELECT count(DISTINCT pharmacy_id) > 1 FROM dispensing_transactions WHERE patient_id = p.id AND is_cancelled = false) as is_shared
FROM patients p
LEFT JOIN last_tx lt ON lt.patient_id = p.id
LEFT JOIN active_tracks at ON at.patient_id = p.id
WHERE p.is_archived = false;

GRANT SELECT ON public.v_patient_status TO authenticated;
GRANT ALL ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
GRANT ALL ON public.dispensing_transactions TO authenticated;
GRANT ALL ON public.dispensing_transactions TO service_role;
