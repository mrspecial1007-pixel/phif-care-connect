-- Manual approval required. Display-only settings: never updates invoice/stock/cost rows.
BEGIN;
CREATE TABLE public.phif_report_box_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  item_identity text NOT NULL CHECK (length(item_identity) BETWEEN 5 AND 1500),
  units_per_box integer NOT NULL CHECK (units_per_box BETWEEN 1 AND 10000),
  base_unit text NOT NULL CHECK (base_unit IN ('tablet','capsule','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES public.pharmacy_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, item_identity)
);
ALTER TABLE public.phif_report_box_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_report_box_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.phif_report_box_settings TO service_role;

CREATE FUNCTION public.set_phif_report_box_setting(p_pharmacy_id uuid, p_actor_id uuid, p_identity text,
  p_units_per_box integer, p_base_unit text, p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE old_row public.phif_report_box_settings; saved public.phif_report_box_settings;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.pharmacy_users u JOIN public.pharmacies p ON p.id=u.pharmacy_id
    WHERE u.id=p_actor_id AND u.pharmacy_id=p_pharmacy_id AND u.role='admin' AND u.is_active
      AND p.name='صيدلية الترياق الشافي') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_identity IS NULL OR p_identity LIKE '%"unresolved"%'
    THEN RAISE EXCEPTION 'Invalid identity or version'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::text || ':' || p_identity, 0));
  SELECT * INTO old_row FROM public.phif_report_box_settings WHERE pharmacy_id=p_pharmacy_id AND item_identity=p_identity FOR UPDATE;
  IF COALESCE(old_row.version,0)<>p_expected_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
  INSERT INTO public.phif_report_box_settings(pharmacy_id,item_identity,units_per_box,base_unit,updated_by)
    VALUES(p_pharmacy_id,p_identity,p_units_per_box,p_base_unit,p_actor_id)
    ON CONFLICT(pharmacy_id,item_identity) DO UPDATE SET units_per_box=EXCLUDED.units_per_box,base_unit=EXCLUDED.base_unit,
      version=phif_report_box_settings.version+1,updated_by=p_actor_id,updated_at=now() RETURNING * INTO saved;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_actor_id,'report_box_setting','phif_report_box_settings',saved.id,
      jsonb_build_object('previous',to_jsonb(old_row),'next',to_jsonb(saved)));
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.set_phif_report_box_setting(uuid,uuid,text,integer,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_report_box_setting(uuid,uuid,text,integer,text,integer) TO service_role;

-- BYPASSRLS does not bypass SQL privileges. Fail closed if ownership, role
-- membership or inherited grants would still allow the application to write.
DO $$
DECLARE
  app_role oid := 'service_role'::regrole;
  settings_table oid := 'public.phif_report_box_settings'::regclass;
  save_function oid := 'public.set_phif_report_box_setting(uuid,uuid,text,integer,text,integer)'::regprocedure;
  table_owner oid;
  function_owner oid;
BEGIN
  SELECT relowner INTO table_owner FROM pg_catalog.pg_class WHERE oid=settings_table;
  SELECT proowner INTO function_owner FROM pg_catalog.pg_proc WHERE oid=save_function;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid=app_role
      AND (rolsuper OR rolcreaterole))
    OR pg_catalog.pg_has_role(app_role,table_owner,'MEMBER')
    OR pg_catalog.pg_has_role(app_role,function_owner,'MEMBER')
    OR pg_catalog.has_table_privilege(app_role,settings_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    OR pg_catalog.has_any_column_privilege(app_role,settings_table,'INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION 'Unsafe report box settings privileges: service_role must have read-only table access and no owner-role membership'; END IF;
  IF NOT pg_catalog.has_table_privilege(app_role,settings_table,'SELECT')
    OR NOT pg_catalog.has_function_privilege(app_role,save_function,'EXECUTE')
  THEN RAISE EXCEPTION 'Missing report box settings read or RPC privileges'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname IN ('anon','authenticated')
      AND (pg_catalog.has_table_privilege(r.oid,settings_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(r.oid,settings_table,'SELECT,INSERT,UPDATE,REFERENCES')
        OR pg_catalog.has_function_privilege(r.oid,save_function,'EXECUTE'))
  ) THEN RAISE EXCEPTION 'Unsafe report box settings privileges: client roles must not access the table or RPC'; END IF;
END $$;
COMMIT;
