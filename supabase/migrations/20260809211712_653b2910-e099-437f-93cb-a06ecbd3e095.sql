-- PART 1 & 3: Delete synthetic test data
DELETE FROM public.communication_logs 
WHERE patient_id IN (
    SELECT id FROM public.patients 
    WHERE patient_name LIKE '%Logic Test%' 
       OR patient_name LIKE '%Multi-track%' 
       OR patient_name LIKE '%Final Logic Test%'
);

DELETE FROM public.dispensing_due_tracks 
WHERE patient_id IN (
    SELECT id FROM public.patients 
    WHERE patient_name LIKE '%Logic Test%' 
       OR patient_name LIKE '%Multi-track%' 
       OR patient_name LIKE '%Final Logic Test%'
);

DELETE FROM public.dispensing_transactions 
WHERE patient_id IN (
    SELECT id FROM public.patients 
    WHERE patient_name LIKE '%Logic Test%' 
       OR patient_name LIKE '%Multi-track%' 
       OR patient_name LIKE '%Final Logic Test%'
);

DELETE FROM public.dispensing_cycles 
WHERE patient_id IN (
    SELECT id FROM public.patients 
    WHERE patient_name LIKE '%Logic Test%' 
       OR patient_name LIKE '%Multi-track%' 
       OR patient_name LIKE '%Final Logic Test%'
);

DELETE FROM public.audit_log 
WHERE (entity_id::text IN (
    SELECT id::text FROM public.patients 
    WHERE patient_name LIKE '%Logic Test%' 
       OR patient_name LIKE '%Multi-track%' 
       OR patient_name LIKE '%Final Logic Test%'
)) OR (after->>'patient_id' IN (
    SELECT id::text FROM public.patients 
    WHERE patient_name LIKE '%Logic Test%' 
       OR patient_name LIKE '%Multi-track%' 
       OR patient_name LIKE '%Final Logic Test%'
));

DELETE FROM public.patients 
WHERE patient_name LIKE '%Logic Test%' 
   OR patient_name LIKE '%Multi-track%' 
   OR patient_name LIKE '%Final Logic Test%';
