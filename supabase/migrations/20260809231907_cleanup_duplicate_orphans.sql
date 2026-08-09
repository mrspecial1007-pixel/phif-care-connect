WITH teryaq_pool AS (
    SELECT DISTINCT p.id
    FROM public.patients p
    JOIN public.dispensing_transactions dt ON p.id = dt.patient_id
    JOIN public.pharmacies ph ON dt.pharmacy_id = ph.id
    WHERE ph.name = 'صيدلية الترياق الشافي'
),
orphans_to_delete AS (
    SELECT ddt.id
    FROM public.dispensing_due_tracks ddt
    JOIN teryaq_pool tp ON ddt.patient_id = tp.id
    WHERE ddt.source_transaction_id IS NULL 
    AND ddt.status = 'Waiting'
    AND EXISTS (
        SELECT 1 FROM public.dispensing_due_tracks t2
        WHERE t2.patient_id = ddt.patient_id
        AND t2.id <> ddt.id
        AND t2.status = 'Waiting'
        AND t2.source_transaction_id IS NOT NULL
        AND t2.next_due_date = ddt.next_due_date
        AND EXISTS (SELECT 1 FROM public.dispensing_transactions dt WHERE dt.id = t2.source_transaction_id)
    )
)
DELETE FROM public.dispensing_due_tracks 
WHERE id IN (SELECT id FROM orphans_to_delete);
