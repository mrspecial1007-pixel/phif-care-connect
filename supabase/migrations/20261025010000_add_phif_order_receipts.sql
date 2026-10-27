-- Apply manually only after approval. No PHIF, invoice, stock or financial writes.
BEGIN;
CREATE TABLE public.phif_order_receipt_sync (
  pharmacy_id uuid PRIMARY KEY REFERENCES public.pharmacies(id),
  fetched_at timestamptz NOT NULL
);
CREATE TABLE public.phif_order_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  order_id text NOT NULL CHECK (order_id ~ '^[0-9]+$'),
  line_id text NOT NULL CHECK (line_id ~ '^[0-9]+$'),
  order_number text NOT NULL,
  order_created_at timestamptz,
  medicine text NOT NULL,
  batch text,
  status text NOT NULL CHECK (status IN ('waiting','received','not_approved','review')),
  first_received_observed_at timestamptz,
  confirmed_received_on date,
  confirmed_by uuid REFERENCES public.pharmacy_users(id),
  confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(pharmacy_id,order_id,line_id),
  UNIQUE(pharmacy_id,line_id),
  CHECK ((confirmed_received_on IS NULL AND confirmed_by IS NULL AND confirmed_at IS NULL)
    OR (confirmed_received_on IS NOT NULL AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
ALTER TABLE public.phif_order_receipt_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phif_order_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_order_receipt_sync, public.phif_order_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.phif_order_receipts TO service_role;

-- Only server-fetched, complete PHIF reads may call this service-only RPC.
CREATE FUNCTION public.observe_phif_order_receipts(p_pharmacy_id uuid,p_actor_id uuid,p_report jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE o jsonb; l jsonb; previous public.phif_order_receipts; saved public.phif_order_receipts;
  fetched timestamptz; last_fetched timestamptz; observed timestamptz := clock_timestamp(); ids text[] := ARRAY[]::text[];
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.pharmacy_users u JOIN public.pharmacies p ON p.id=u.pharmacy_id
    WHERE u.id=p_actor_id AND u.pharmacy_id=p_pharmacy_id AND u.is_active AND p.name='صيدلية الترياق الشافي'
      AND (u.role='admin' OR COALESCE((u.permissions->>'inventory_read')::boolean,false))) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_report IS NULL OR p_report->>'complete' IS DISTINCT FROM 'true'
    OR jsonb_typeof(p_report->'orders') IS DISTINCT FROM 'array'
    OR p_report->>'totalOrders' IS NULL OR jsonb_array_length(p_report->'orders')<>(p_report->>'totalOrders')::integer
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'orders') r WHERE r->>'detailError' IS NOT NULL)
    THEN RAISE EXCEPTION 'Incomplete order read'; END IF;
  fetched := (p_report->>'fetchedAt')::timestamptz;
  IF fetched IS NULL OR fetched>observed+interval '5 minutes' THEN RAISE EXCEPTION 'Invalid read timestamp'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phif-order-receipts:'||p_pharmacy_id::text,0));
  SELECT fetched_at INTO last_fetched FROM public.phif_order_receipt_sync WHERE pharmacy_id=p_pharmacy_id;
  IF fetched<last_fetched THEN RAISE EXCEPTION 'Stale order read'; END IF;
  IF fetched=last_fetched THEN RETURN; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_report->'orders')) <>
     (SELECT count(DISTINCT r->>'id') FROM jsonb_array_elements(p_report->'orders') r)
    THEN RAISE EXCEPTION 'Duplicate order identity'; END IF;
  FOR o IN SELECT * FROM jsonb_array_elements(p_report->'orders') LOOP
    IF COALESCE(o->>'id','') !~ '^[0-9]+$' OR COALESCE(o->>'number','')='' OR jsonb_typeof(o->'lines') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'Invalid order identity'; END IF;
    FOR l IN SELECT * FROM jsonb_array_elements(o->'lines') LOOP
      IF COALESCE(l->>'id','') !~ '^[0-9]+$' OR l->>'id'=ANY(ids) OR COALESCE(l->>'medicine','')=''
        OR COALESCE(l->>'status','') NOT IN ('waiting','received','not_approved','review')
        THEN RAISE EXCEPTION 'Invalid or duplicate line'; END IF;
      ids := array_append(ids,l->>'id');
      SELECT * INTO previous FROM public.phif_order_receipts WHERE pharmacy_id=p_pharmacy_id AND line_id=l->>'id' FOR UPDATE;
      IF previous.id IS NOT NULL AND (previous.order_id IS DISTINCT FROM o->>'id'
        OR previous.order_number IS DISTINCT FROM o->>'number' OR previous.medicine IS DISTINCT FROM l->>'medicine'
        OR previous.batch IS DISTINCT FROM l->>'batch'
        OR previous.order_created_at IS DISTINCT FROM (o->>'createdAt')::timestamptz)
        THEN RAISE EXCEPTION 'Order line identity changed'; END IF;
      INSERT INTO public.phif_order_receipts(pharmacy_id,order_id,line_id,order_number,order_created_at,medicine,batch,status)
        VALUES(p_pharmacy_id,o->>'id',l->>'id',o->>'number',(o->>'createdAt')::timestamptz,l->>'medicine',l->>'batch',l->>'status')
        ON CONFLICT(pharmacy_id,line_id) DO UPDATE SET status=EXCLUDED.status,
          first_received_observed_at=COALESCE(phif_order_receipts.first_received_observed_at,
            CASE WHEN phif_order_receipts.status IN ('waiting','not_approved') AND EXCLUDED.status='received' THEN observed END),
          version=phif_order_receipts.version+CASE WHEN phif_order_receipts.status IS DISTINCT FROM EXCLUDED.status THEN 1 ELSE 0 END
        RETURNING * INTO saved;
      IF saved.first_received_observed_at IS NOT NULL AND previous.first_received_observed_at IS NULL THEN
        INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
          VALUES(p_pharmacy_id,p_actor_id,'order_receipt_first_observed','phif_order_receipts',saved.id,
            jsonb_build_object('order_id',saved.order_id,'line_id',saved.line_id,'observed_at',saved.first_received_observed_at,'actual_receipt_date',false));
      END IF;
    END LOOP;
  END LOOP;
  -- Approved-zero lines may legitimately disappear from the filtered report.
  -- Retain their history, but reject a read that omits an entire known order.
  IF EXISTS(SELECT 1 FROM public.phif_order_receipts r WHERE r.pharmacy_id=p_pharmacy_id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'orders') x WHERE x->>'id'=r.order_id))
    THEN RAISE EXCEPTION 'Incomplete orders; existing order omitted'; END IF;
  INSERT INTO public.phif_order_receipt_sync VALUES(p_pharmacy_id,fetched)
    ON CONFLICT(pharmacy_id) DO UPDATE SET fetched_at=EXCLUDED.fetched_at;
END $$;

CREATE FUNCTION public.set_phif_order_receipt_date(p_pharmacy_id uuid,p_actor_id uuid,p_order_id text,p_line_id text,
  p_received_on date,p_expected_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous public.phif_order_receipts; saved public.phif_order_receipts;
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.pharmacy_users u JOIN public.pharmacies p ON p.id=u.pharmacy_id
    WHERE u.id=p_actor_id AND u.pharmacy_id=p_pharmacy_id AND u.role='admin' AND u.is_active AND p.name='صيدلية الترياق الشافي')
    THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('phif-order-receipts:'||p_pharmacy_id::text,0));
  SELECT * INTO previous FROM public.phif_order_receipts
    WHERE pharmacy_id=p_pharmacy_id AND order_id=p_order_id AND line_id=p_line_id FOR UPDATE;
  IF previous.id IS NULL OR previous.status<>'received' THEN RAISE EXCEPTION 'Received line not found'; END IF;
  IF p_expected_version IS NULL OR previous.version<>p_expected_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
  IF p_received_on IS NOT NULL AND (previous.order_created_at IS NULL
    OR p_received_on<(previous.order_created_at AT TIME ZONE 'Africa/Tripoli')::date
    OR p_received_on>(clock_timestamp() AT TIME ZONE 'Africa/Tripoli')::date)
    THEN RAISE EXCEPTION 'Receipt date outside valid range'; END IF;
  IF previous.confirmed_received_on IS NOT DISTINCT FROM p_received_on THEN RETURN to_jsonb(previous); END IF;
  UPDATE public.phif_order_receipts SET confirmed_received_on=p_received_on,
    confirmed_by=CASE WHEN p_received_on IS NULL THEN NULL ELSE p_actor_id END,
    confirmed_at=CASE WHEN p_received_on IS NULL THEN NULL ELSE clock_timestamp() END,version=version+1
    WHERE id=previous.id RETURNING * INTO saved;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_actor_id,'order_receipt_date','phif_order_receipts',saved.id,
      jsonb_build_object('previous',to_jsonb(previous),'next',to_jsonb(saved)));
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.observe_phif_order_receipts(uuid,uuid,jsonb),
  public.set_phif_order_receipt_date(uuid,uuid,text,text,date,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.observe_phif_order_receipts(uuid,uuid,jsonb),
  public.set_phif_order_receipt_date(uuid,uuid,text,text,date,integer) TO service_role;
DO $$
DECLARE t regclass; f regprocedure; app oid := 'service_role'::regrole;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=app AND (rolsuper OR rolcreaterole)) THEN RAISE EXCEPTION 'Unsafe service role'; END IF;
  FOREACH t IN ARRAY ARRAY['public.phif_order_receipts'::regclass,'public.phif_order_receipt_sync'::regclass] LOOP
    IF pg_has_role(app,(SELECT relowner FROM pg_class WHERE oid=t),'MEMBER')
      OR has_table_privilege(app,t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(app,t,'INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Unsafe table write privileges'; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.observe_phif_order_receipts(uuid,uuid,jsonb)'::regprocedure,
    'public.set_phif_order_receipt_date(uuid,uuid,text,text,date,integer)'::regprocedure] LOOP
    IF pg_has_role(app,(SELECT proowner FROM pg_proc WHERE oid=f),'MEMBER')
      OR has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
      THEN RAISE EXCEPTION 'Unsafe RPC privileges'; END IF;
  END LOOP;
END $$;
COMMIT;
