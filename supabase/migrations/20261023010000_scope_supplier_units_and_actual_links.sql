-- MANUAL APPROVAL REQUIRED. Schema/RPC only: no backfill or imported financial writes.
BEGIN;
ALTER TABLE public.phif_report_box_settings
  ADD COLUMN supplier_quantity_unit text CHECK (supplier_quantity_unit IN
    ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet')),
  ADD COLUMN supplier_unit_exceptions jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(supplier_unit_exceptions)='object');

CREATE FUNCTION public.set_phif_report_supplier_unit(
  p_pharmacy_id uuid, p_actor_id uuid, p_identity text, p_unit text,
  p_exceptions jsonb, p_expected_version integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE old_row public.phif_report_box_settings; saved public.phif_report_box_settings; e record;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacy_users u JOIN public.pharmacies p ON p.id=u.pharmacy_id
    WHERE u.id=p_actor_id AND u.pharmacy_id=p_pharmacy_id AND u.role='admin' AND u.is_active
      AND p.name='صيدلية الترياق الشافي'
  ) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_identity IS NULL
    OR p_exceptions IS NULL OR jsonb_typeof(p_exceptions)<>'object'
    OR jsonb_array_length(p_identity::jsonb)<>3
  THEN RAISE EXCEPTION 'Invalid supplier quantity decision'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::text||':'||p_identity,0));
  SELECT * INTO old_row FROM public.phif_report_box_settings
    WHERE pharmacy_id=p_pharmacy_id AND item_identity=p_identity FOR UPDATE;
  IF old_row.id IS NULL OR old_row.version<>p_expected_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
  IF p_unit IS NOT NULL AND p_unit NOT IN ('box','strip',old_row.base_unit)
    THEN RAISE EXCEPTION 'Quantity unit conflicts with the recorded dosage unit'; END IF;
  FOR e IN SELECT * FROM jsonb_each_text(p_exceptions) LOOP
    IF e.value NOT IN ('unknown','box','strip',old_row.base_unit)
      OR NOT EXISTS (SELECT 1 FROM public.phif_invoices f JOIN public.phif_invoice_items i ON i.phif_invoice_id=f.id
        WHERE f.id=e.key::uuid AND f.pharmacy_id=p_pharmacy_id AND i.source_classification='phif-supplier')
    THEN RAISE EXCEPTION 'Invalid invoice exception'; END IF;
  END LOOP;
  IF old_row.supplier_quantity_unit IS NOT DISTINCT FROM p_unit AND old_row.supplier_unit_exceptions=p_exceptions
    THEN RETURN to_jsonb(old_row); END IF;
  UPDATE public.phif_report_box_settings SET supplier_quantity_unit=p_unit,supplier_unit_exceptions=p_exceptions,
    version=version+1,updated_by=p_actor_id,updated_at=now() WHERE id=old_row.id RETURNING * INTO saved;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_actor_id,'report_supplier_unit','phif_report_box_settings',saved.id,
      jsonb_build_object('previous',to_jsonb(old_row),'next',to_jsonb(saved)));
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.set_phif_report_supplier_unit(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_report_supplier_unit(uuid,uuid,text,text,jsonb,integer) TO service_role;

ALTER TABLE public.phif_actual_stock_links ADD COLUMN source_identity text
  CHECK (source_identity IS NULL OR (length(source_identity) BETWEEN 5 AND 1500
    AND jsonb_typeof(source_identity::jsonb)='array' AND jsonb_array_length(source_identity::jsonb)=2));
-- Legacy decisions remain intact. Only explicit future edits consolidate their active relationship.
CREATE UNIQUE INDEX phif_actual_active_identity_unique ON public.phif_actual_stock_links(pharmacy_id,source_identity)
  WHERE is_active AND source_identity IS NOT NULL;
REVOKE ALL ON public.phif_actual_stock_links FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.phif_actual_stock_links TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_phif_actual_stock_link(uuid,uuid,uuid,text,integer,uuid,text,boolean) FROM service_role;

CREATE FUNCTION public.set_phif_actual_identity_link(
  p_pharmacy_id uuid,p_item_id uuid,p_target_id uuid,p_signature text,p_identity text,
  p_expected_members jsonb,p_user_id uuid,p_actor text,p_revoke boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE member jsonb; old_row public.phif_actual_stock_links; saved public.phif_actual_stock_links;
  source_row public.phif_invoice_items; ids uuid[]:=ARRAY[]::uuid[]; target_row public.phif_stock_items;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacy_users u JOIN public.pharmacies p ON p.id=u.pharmacy_id
    WHERE u.id=p_user_id AND u.pharmacy_id=p_pharmacy_id AND u.role='admin' AND u.is_active
      AND p.name='صيدلية الترياق الشافي'
  ) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_revoke IS NULL OR p_identity IS NULL OR length(p_identity) NOT BETWEEN 5 AND 1500
    OR jsonb_typeof(p_identity::jsonb)<>'array' OR jsonb_array_length(p_identity::jsonb)<>2
    OR jsonb_typeof(p_identity::jsonb->0)<>'array' OR jsonb_array_length(p_identity::jsonb->0)<>3
    OR p_expected_members IS NULL OR jsonb_typeof(p_expected_members)<>'array'
  THEN RAISE EXCEPTION 'Invalid identity scope'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_pharmacy_id::text||':actual:'||p_identity,0));
  SELECT i.* INTO source_row FROM public.phif_invoice_items i JOIN public.phif_invoices f ON f.id=i.phif_invoice_id
    WHERE i.id=p_item_id AND f.pharmacy_id=p_pharmacy_id AND i.source_classification='actual-supplier' FOR UPDATE OF i;
  IF NOT FOUND OR p_signature IS NULL OR p_signature::jsonb IS DISTINCT FROM
    jsonb_build_array(source_row.brand,source_row.strength,source_row.source_classification,coalesce(source_row.metadata,'{}'::jsonb))
  THEN RAISE EXCEPTION 'Source changed'; END IF;
  IF NOT p_revoke THEN
    SELECT * INTO target_row FROM public.phif_stock_items WHERE id=p_target_id AND pharmacy_id=p_pharmacy_id AND is_current;
    IF NOT FOUND THEN RAISE EXCEPTION 'Current target unavailable'; END IF;
  END IF;
  FOR member IN SELECT * FROM jsonb_array_elements(p_expected_members) LOOP
    SELECT * INTO old_row FROM public.phif_actual_stock_links WHERE id=(member->>'id')::uuid AND pharmacy_id=p_pharmacy_id FOR UPDATE;
    IF NOT FOUND OR old_row.version IS DISTINCT FROM (member->>'version')::integer
      OR (old_row.source_identity IS NOT NULL AND old_row.source_identity<>p_identity)
      OR old_row.id=ANY(ids) THEN RAISE EXCEPTION 'Link version conflict'; END IF;
    ids:=array_append(ids,old_row.id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.phif_actual_stock_links WHERE pharmacy_id=p_pharmacy_id
    AND ((is_active AND source_identity=p_identity) OR phif_invoice_item_id=p_item_id) AND NOT(id=ANY(ids)))
  THEN RAISE EXCEPTION 'Relationship changed'; END IF;
  -- Retain every decision and its audit trail. Never update invoices, quantities or costs.
  FOR old_row IN SELECT * FROM public.phif_actual_stock_links WHERE id=ANY(ids) AND is_active LOOP
    UPDATE public.phif_actual_stock_links SET is_active=false,source_identity=p_identity,version=version+1,updated_by=p_user_id,
      updated_actor=p_actor,updated_at=now() WHERE id=old_row.id RETURNING * INTO saved;
    INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
      VALUES(p_pharmacy_id,p_user_id,'actual_stock_link_revoke','phif_actual_stock_link',saved.id,
        jsonb_build_object('actor',p_actor,'before',to_jsonb(old_row),'after',to_jsonb(saved),'scope',p_identity));
  END LOOP;
  IF p_revoke THEN RETURN jsonb_build_object('revoked',true,'relationships',cardinality(ids)); END IF;
  SELECT * INTO old_row FROM public.phif_actual_stock_links WHERE pharmacy_id=p_pharmacy_id AND phif_invoice_item_id=p_item_id;
  INSERT INTO public.phif_actual_stock_links(pharmacy_id,phif_invoice_item_id,target_stock_item_id,source_signature,source_identity,updated_by,updated_actor)
    VALUES(p_pharmacy_id,p_item_id,p_target_id,p_signature,p_identity,p_user_id,p_actor)
    ON CONFLICT(pharmacy_id,phif_invoice_item_id) DO UPDATE SET target_stock_item_id=excluded.target_stock_item_id,
      source_signature=excluded.source_signature,source_identity=excluded.source_identity,is_active=true,
      version=phif_actual_stock_links.version+1,updated_by=p_user_id,updated_actor=p_actor,updated_at=now()
    RETURNING * INTO saved;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_user_id,'actual_stock_link_save','phif_actual_stock_link',saved.id,
      jsonb_build_object('actor',p_actor,'before',to_jsonb(old_row),'after',to_jsonb(saved),'scope',p_identity));
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.set_phif_actual_identity_link(uuid,uuid,uuid,text,text,jsonb,uuid,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_actual_identity_link(uuid,uuid,uuid,text,text,jsonb,uuid,text,boolean) TO service_role;

DO $$
DECLARE tab regclass;
BEGIN
  FOREACH tab IN ARRAY ARRAY['public.phif_actual_stock_links'::regclass,'public.phif_report_box_settings'::regclass] LOOP
    IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role' AND (rolsuper OR rolcreaterole))
      OR pg_catalog.pg_has_role('service_role',(SELECT relowner FROM pg_catalog.pg_class WHERE oid=tab),'MEMBER')
      OR pg_catalog.has_table_privilege('service_role',tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR pg_catalog.has_any_column_privilege('service_role',tab,'INSERT,UPDATE,REFERENCES')
    THEN RAISE EXCEPTION 'Unsafe service role write privileges'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_roles r ON r.oid=f.proowner
    WHERE f.oid IN ('public.set_phif_report_supplier_unit(uuid,uuid,text,text,jsonb,integer)'::regprocedure,
      'public.set_phif_actual_identity_link(uuid,uuid,uuid,text,text,jsonb,uuid,text,boolean)'::regprocedure)
      AND pg_catalog.pg_has_role('service_role',r.oid,'MEMBER'))
  THEN RAISE EXCEPTION 'Unsafe RPC owner role membership'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
