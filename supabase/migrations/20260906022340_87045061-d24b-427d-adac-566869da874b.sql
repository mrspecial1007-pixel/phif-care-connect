REVOKE ALL ON public.v_pharmacies_public FROM anon, authenticated;
GRANT SELECT ON public.v_pharmacies_public TO anon, authenticated;