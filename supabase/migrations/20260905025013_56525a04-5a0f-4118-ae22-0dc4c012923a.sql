-- P0: revoke broad anonymous access (applied only after all reads were migrated & verified)
DROP POLICY IF EXISTS "public read patients" ON public.patients;
DROP POLICY IF EXISTS "public read pharmacy names" ON public.pharmacies;
DROP POLICY IF EXISTS "public read tx" ON public.dispensing_transactions;
DROP POLICY IF EXISTS "public read due tracks" ON public.dispensing_due_tracks;
DROP POLICY IF EXISTS "public read cycles" ON public.dispensing_cycles;

REVOKE ALL ON public.patients FROM anon;
REVOKE ALL ON public.pharmacies FROM anon;
REVOKE ALL ON public.dispensing_transactions FROM anon;
REVOKE ALL ON public.dispensing_due_tracks FROM anon;
REVOKE ALL ON public.dispensing_cycles FROM anon;
REVOKE ALL ON public.v_patient_status FROM anon;
REVOKE ALL ON public.v_pharmacies FROM anon;

GRANT ALL ON public.patients TO service_role;
GRANT ALL ON public.pharmacies TO service_role;
GRANT ALL ON public.dispensing_transactions TO service_role;
GRANT ALL ON public.dispensing_due_tracks TO service_role;
GRANT ALL ON public.dispensing_cycles TO service_role;
GRANT SELECT ON public.v_patient_status TO service_role;
GRANT SELECT ON public.v_pharmacies TO service_role;