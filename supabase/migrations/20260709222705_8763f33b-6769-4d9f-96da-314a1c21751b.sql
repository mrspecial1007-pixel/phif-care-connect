
-- Column-level: anon can only see id, name, created_at (never pin_hash)
REVOKE SELECT ON public.pharmacies FROM anon;
GRANT SELECT (id, name, created_at) ON public.pharmacies TO anon;
CREATE POLICY "public read pharmacy names" ON public.pharmacies FOR SELECT TO anon USING (true);

-- Audit log: explicit no-access for anon
CREATE POLICY "no anon access to audit" ON public.audit_log FOR SELECT TO anon USING (false);
