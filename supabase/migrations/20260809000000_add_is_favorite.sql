ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;

-- Update the view to include is_favorite
DROP VIEW IF EXISTS public.v_patient_status;
CREATE VIEW public.v_patient_status AS
WITH last_tx AS (
    SELECT DISTINCT ON (patient_id)
        patient_id,
        dispensing_date,
        pharmacy_id,
        pharmacies.name as pharmacy_name
    FROM public.dispensing_transactions
    JOIN public.pharmacies ON pharmacies.id = dispensing_transactions.pharmacy_id
    ORDER BY patient_id, dispensing_date DESC, created_at DESC
),
current_cycles AS (
    SELECT DISTINCT ON (patient_id)
        id,
        patient_id,
        status,
        started_at,
        next_due_date
    FROM public.dispensing_cycles
    ORDER BY patient_id, started_at DESC, created_at DESC
)
SELECT 
    p.id as patient_id,
    p.patient_name,
    p.insurance_card_number,
    p.national_id,
    p.phone,
    p.review_status,
    p.is_favorite,
    lt.dispensing_date as last_dispensing_date,
    lt.pharmacy_id as last_pharmacy_id,
    lt.pharmacy_name as last_pharmacy_name,
    cc.id as current_cycle_id,
    cc.status as current_cycle_status,
    cc.started_at as current_cycle_started_at,
    cc.next_due_date,
    (cc.next_due_date::date - CURRENT_DATE) as remaining_days,
    (SELECT count(DISTINCT pharmacy_id) FROM public.dispensing_transactions WHERE patient_id = p.id) as pharmacy_count,
    ((SELECT count(DISTINCT pharmacy_id) FROM public.dispensing_transactions WHERE patient_id = p.id) > 1) as is_shared
FROM public.patients p
LEFT JOIN last_tx lt ON lt.patient_id = p.id
LEFT JOIN current_cycles cc ON cc.patient_id = p.id;

-- Re-grant permissions on the view
GRANT SELECT ON public.v_patient_status TO authenticated;
GRANT ALL ON public.v_patient_status TO service_role;
