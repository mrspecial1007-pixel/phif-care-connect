-- Related data will be deleted by CASCADE on foreign keys if configured, 
-- but let's be safe and target them specifically if they don't have ON DELETE CASCADE.
-- Assuming standard foreign keys:
DELETE FROM public.dispensing_transactions WHERE patient_id IN (
    SELECT id FROM public.patients 
    WHERE patient_name ILIKE 'Test Beneficiary%' 
       OR patient_name ILIKE 'TEST%' 
       OR patient_name ILIKE 'Logic Test%' 
       OR patient_name ILIKE 'Multi-track Logic Test%' 
       OR patient_name ILIKE 'Final Logic Test%' 
       OR patient_name ILIKE 'Verification Test%'
);

DELETE FROM public.dispensing_due_tracks WHERE patient_id IN (
    SELECT id FROM public.patients 
    WHERE patient_name ILIKE 'Test Beneficiary%' 
       OR patient_name ILIKE 'TEST%' 
       OR patient_name ILIKE 'Logic Test%' 
       OR patient_name ILIKE 'Multi-track Logic Test%' 
       OR patient_name ILIKE 'Final Logic Test%' 
       OR patient_name ILIKE 'Verification Test%'
);

DELETE FROM public.patients 
WHERE patient_name ILIKE 'Test Beneficiary%' 
   OR patient_name ILIKE 'TEST%' 
   OR patient_name ILIKE 'Logic Test%' 
   OR patient_name ILIKE 'Multi-track Logic Test%' 
   OR patient_name ILIKE 'Final Logic Test%' 
   OR patient_name ILIKE 'Verification Test%';
