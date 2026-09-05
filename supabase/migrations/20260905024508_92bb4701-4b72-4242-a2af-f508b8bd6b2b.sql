CREATE OR REPLACE VIEW public.v_pharmacies_public
WITH (security_invoker = false) AS
SELECT id, name FROM public.pharmacies;

GRANT SELECT ON public.v_pharmacies_public TO anon, authenticated;
GRANT ALL ON public.v_pharmacies_public TO service_role;