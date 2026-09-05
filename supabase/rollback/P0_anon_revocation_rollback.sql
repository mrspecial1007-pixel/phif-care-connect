-- P0 ROLLBACK (prepared, NOT applied)
-- Inverse of the P0 anonymous-access revocation.
-- Restores the pre-P0 broad anonymous read access exactly as it was.
-- Requires no frontend redeployment.

GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.patients, public.pharmacies, public.dispensing_transactions,
     public.dispensing_due_tracks, public.dispensing_cycles
  TO anon;
GRANT SELECT ON public.v_patient_status, public.v_pharmacies TO anon;

CREATE POLICY "public read patients" ON public.patients FOR SELECT TO anon USING (true);
CREATE POLICY "public read pharmacy names" ON public.pharmacies FOR SELECT TO anon USING (true);
CREATE POLICY "public read tx" ON public.dispensing_transactions FOR SELECT TO anon USING (true);
CREATE POLICY "public read due tracks" ON public.dispensing_due_tracks FOR SELECT TO anon USING (true);
CREATE POLICY "public read cycles" ON public.dispensing_cycles FOR SELECT TO anon USING (true);
