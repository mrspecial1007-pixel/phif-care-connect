-- LOCAL REVIEW ONLY. Uses the ALREADY INSTALLED receipt tables/RPCs; never reapplies their migration.
-- No backfill, legacy-run reset, invoice, price, cost, or receipt-date changes.
BEGIN;
DO $preflight$
DECLARE missing text; f regprocedure; required record; app oid := 'service_role'::regrole;
BEGIN
  IF current_user IN ('anon','authenticated','service_role') THEN RAISE EXCEPTION 'Migration requires a privileged owner'; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=app AND (rolsuper OR rolcreaterole)) THEN RAISE EXCEPTION 'Unsafe service role'; END IF;
  SELECT r.t||'.'||r.c INTO missing FROM (VALUES
    ('phif_order_receipts','id','uuid'),('phif_order_receipts','pharmacy_id','uuid'),
    ('phif_order_receipts','order_id','text'),('phif_order_receipts','line_id','text'),
    ('phif_order_receipts','order_number','text'),('phif_order_receipts','order_created_at','timestamptz'),
    ('phif_order_receipts','medicine','text'),('phif_order_receipts','batch','text'),('phif_order_receipts','status','text'),
    ('phif_order_receipts','first_received_observed_at','timestamptz'),('phif_order_receipts','confirmed_received_on','date'),
    ('phif_order_receipts','confirmed_by','uuid'),('phif_order_receipts','confirmed_at','timestamptz'),('phif_order_receipts','version','int4'),
    ('phif_order_receipt_sync','pharmacy_id','uuid'),('phif_order_receipt_sync','fetched_at','timestamptz'),
    ('phif_stock_sync_runs','id','uuid'),('phif_stock_sync_runs','pharmacy_id','uuid'),('phif_stock_sync_runs','status','text'),
    ('phif_stock_sync_runs','started_at','timestamptz'),('phif_stock_sync_runs','finished_at','timestamptz'),
    ('phif_stock_sync_runs','total_records','int4'),('phif_stock_sync_runs','imported_records','int4'),
    ('phif_stock_sync_runs','error_count','int4'),('phif_stock_sync_runs','error_message','text'),
    ('phif_bridge_sessions','id','uuid'),('phif_bridge_sessions','pharmacy_id','uuid'),
    ('phif_bridge_sessions','status','text'),('phif_bridge_sessions','expires_at','timestamptz'),
    ('pharmacy_users','id','uuid'),('pharmacy_users','pharmacy_id','uuid'),('pharmacy_users','role','text'),
    ('pharmacy_users','is_active','bool'),('pharmacy_users','permissions','jsonb'),
    ('user_operation_log','pharmacy_id','uuid'),('user_operation_log','user_id','uuid'),('user_operation_log','entity_id','uuid'),
    ('user_operation_log','action','text'),('user_operation_log','entity','text'),('user_operation_log','metadata','jsonb'),
    ('pharmacies','id','uuid'),('pharmacies','name','text')
  ) r(t,c,typ) WHERE NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||r.t)
    AND a.attname=r.c AND a.atttypid=r.typ::regtype AND a.attnum>0 AND NOT a.attisdropped) LIMIT 1;
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'Installed schema contract mismatch: %; inspect it, do not reapply the old migration',missing; END IF;
  FOR required IN SELECT * FROM (VALUES
    ('public.observe_phif_order_receipts(uuid,uuid,jsonb)','void'),
    ('public.set_phif_order_receipt_date(uuid,uuid,text,text,date,integer)','jsonb'),
    ('public.replace_phif_stock_snapshots(uuid,uuid,jsonb)','int4')
  ) r(sig,ret) LOOP
    f := to_regprocedure(required.sig);
    IF f IS NULL OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=f AND prorettype=required.ret::regtype AND prosecdef)
      THEN RAISE EXCEPTION 'Installed RPC contract mismatch: %',required.sig; END IF;
    IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
      OR NOT has_function_privilege('service_role',f,'EXECUTE')
      OR pg_has_role(app,(SELECT proowner FROM pg_proc WHERE oid=f),'MEMBER')
      THEN RAISE EXCEPTION 'Unsafe existing RPC privileges: %',required.sig; END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid='public.phif_order_receipts'::regclass
    AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=2
    AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(n,pos)
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.n WHERE k.pos<=i.indnkeyatts ORDER BY a.attname)
      =ARRAY['line_id','pharmacy_id']) THEN RAISE EXCEPTION 'Receipt identity unique index is missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indexrelid=to_regclass('public.phif_stock_sync_runs_one_pending_per_pharmacy_uidx')
    AND i.indrelid='public.phif_stock_sync_runs'::regclass AND i.indisunique AND i.indisvalid AND i.indnkeyatts=1
    AND i.indkey[0]=(SELECT attnum FROM pg_attribute WHERE attrelid=i.indrelid AND attname='pharmacy_id')
    AND pg_get_expr(i.indpred,i.indrelid)='(status = ''pending''::text)') THEN RAISE EXCEPTION 'Stock pending unique index contract changed'; END IF;
  IF to_regclass('public.phif_order_snapshots') IS NOT NULL OR to_regclass('public.phif_manual_sync_operations') IS NOT NULL
    OR to_regprocedure('public._apply_phif_stock_snapshots(uuid,uuid,jsonb)') IS NOT NULL
    THEN RAISE EXCEPTION 'Shared-sync objects already exist; inspect migration state instead of replaying it'; END IF;
END $preflight$;

CREATE TABLE public.phif_order_snapshots (
  pharmacy_id uuid PRIMARY KEY REFERENCES public.pharmacies(id),
  report jsonb NOT NULL CHECK (jsonb_typeof(report)='object'),
  version integer NOT NULL CHECK (version>0),
  fetched_at timestamptz NOT NULL,
  saved_by uuid NOT NULL REFERENCES public.pharmacy_users(id),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.phif_manual_sync_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  actor_id uuid NOT NULL REFERENCES public.pharmacy_users(id),
  session_record_id uuid NOT NULL REFERENCES public.phif_bridge_sessions(id),
  kind text NOT NULL CHECK (kind IN ('orders','stock')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '3 minutes',
  finished_at timestamptz,
  CHECK (expires_at>started_at),
  CHECK ((status='pending')=(finished_at IS NULL))
);
CREATE UNIQUE INDEX phif_manual_sync_one_pending ON public.phif_manual_sync_operations(pharmacy_id) WHERE status='pending';
CREATE INDEX phif_manual_sync_latest ON public.phif_manual_sync_operations(pharmacy_id,started_at DESC);
ALTER TABLE public.phif_order_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phif_manual_sync_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_order_snapshots,public.phif_manual_sync_operations FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.phif_order_snapshots,public.phif_manual_sync_operations TO service_role;

CREATE FUNCTION public._phif_manual_sync_actor(p_pharmacy_id uuid,p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
  IF p_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.pharmacy_users u JOIN public.pharmacies p ON p.id=u.pharmacy_id
    WHERE u.id=p_actor_id AND u.pharmacy_id=p_pharmacy_id AND u.is_active
      AND p.name='صيدلية الترياق الشافي'
      AND (u.role='admin' OR COALESCE((u.permissions->>'inventory_read')::boolean,false))
  ) THEN RAISE EXCEPTION 'Forbidden'; END IF;
END $$;

CREATE FUNCTION public.begin_phif_manual_sync(p_pharmacy_id uuid,p_actor_id uuid,p_kind text,p_session_record_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE previous public.phif_manual_sync_operations; op public.phif_manual_sync_operations; v integer;
BEGIN
  PERFORM public._phif_manual_sync_actor(p_pharmacy_id,p_actor_id);
  IF p_kind IS NULL OR p_kind NOT IN ('orders','stock') THEN RAISE EXCEPTION 'Invalid sync kind'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('phif-manual-sync:'||p_pharmacy_id::text,0))
    THEN RAISE EXCEPTION 'PHIF_SYNC_BUSY'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.phif_bridge_sessions WHERE id=p_session_record_id AND pharmacy_id=p_pharmacy_id
    AND status='active' AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'No available session'; END IF;
  SELECT * INTO previous FROM public.phif_manual_sync_operations WHERE pharmacy_id=p_pharmacy_id AND status='pending' FOR UPDATE;
  IF previous.id IS NOT NULL THEN
    IF previous.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'PHIF_SYNC_BUSY'; END IF;
    -- Only managed, expired leases may be reclaimed. Completion uses the same lock/fence.
    UPDATE public.phif_manual_sync_operations SET status='failed',finished_at=clock_timestamp() WHERE id=previous.id;
    IF previous.kind='stock' THEN
      UPDATE public.phif_stock_sync_runs SET status='failed',finished_at=clock_timestamp(),error_count=1,
        error_message='Managed sync lease expired; stale worker fenced' WHERE id=previous.id AND pharmacy_id=p_pharmacy_id AND status='pending';
    END IF;
    INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
      VALUES(p_pharmacy_id,p_actor_id,'phif_sync_lease_expired','phif_manual_sync_operations',previous.id,jsonb_build_object('kind',previous.kind));
  END IF;
  IF EXISTS(SELECT 1 FROM public.phif_stock_sync_runs WHERE pharmacy_id=p_pharmacy_id AND status='pending') THEN
    RAISE EXCEPTION 'PHIF_LEGACY_PENDING_REQUIRES_REVIEW';
  END IF;
  IF EXISTS(SELECT 1 FROM public.phif_manual_sync_operations WHERE pharmacy_id=p_pharmacy_id
    AND id IS DISTINCT FROM previous.id
    AND greatest(started_at,COALESCE(finished_at,started_at))>clock_timestamp()-interval '10 seconds')
    THEN RAISE EXCEPTION 'PHIF_SYNC_COOLDOWN'; END IF;
  INSERT INTO public.phif_manual_sync_operations(pharmacy_id,actor_id,kind,session_record_id)
    VALUES(p_pharmacy_id,p_actor_id,p_kind,p_session_record_id) RETURNING * INTO op;
  IF p_kind='stock' THEN
    INSERT INTO public.phif_stock_sync_runs(id,pharmacy_id,status) VALUES(op.id,p_pharmacy_id,'pending');
  END IF;
  SELECT version INTO v FROM public.phif_order_snapshots WHERE pharmacy_id=p_pharmacy_id;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_actor_id,'phif_manual_sync_started','phif_manual_sync_operations',op.id,jsonb_build_object('kind',p_kind));
  RETURN jsonb_build_object('id',op.id,'snapshot_version',COALESCE(v,0),'expires_at',op.expires_at);
END $$;

CREATE FUNCTION public.fail_phif_manual_sync(p_pharmacy_id uuid,p_actor_id uuid,p_operation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE op public.phif_manual_sync_operations;
BEGIN
  PERFORM public._phif_manual_sync_actor(p_pharmacy_id,p_actor_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('phif-manual-sync:'||p_pharmacy_id::text,0));
  SELECT * INTO op FROM public.phif_manual_sync_operations WHERE id=p_operation_id AND pharmacy_id=p_pharmacy_id AND actor_id=p_actor_id FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF op.status<>'pending' THEN RETURN op.status; END IF;
  UPDATE public.phif_manual_sync_operations SET status='failed',finished_at=clock_timestamp() WHERE id=op.id;
  IF op.kind='stock' THEN
    UPDATE public.phif_stock_sync_runs SET status='failed',finished_at=clock_timestamp(),error_count=1,
      error_message='Manual PHIF sync failed; previous stock retained' WHERE id=op.id AND pharmacy_id=p_pharmacy_id AND status='pending';
  END IF;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_actor_id,'phif_manual_sync_failed','phif_manual_sync_operations',op.id,jsonb_build_object('kind',op.kind));
  RETURN 'failed';
END $$;

CREATE FUNCTION public.complete_phif_orders_sync(p_pharmacy_id uuid,p_actor_id uuid,p_operation_id uuid,p_expected_version integer,p_report jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE op public.phif_manual_sync_operations; previous public.phif_order_snapshots; fetched timestamptz; observed_at timestamptz; v integer;
BEGIN
  PERFORM public._phif_manual_sync_actor(p_pharmacy_id,p_actor_id);
  PERFORM pg_advisory_xact_lock(hashtextextended('phif-manual-sync:'||p_pharmacy_id::text,0));
  SELECT * INTO op FROM public.phif_manual_sync_operations WHERE id=p_operation_id AND pharmacy_id=p_pharmacy_id AND actor_id=p_actor_id AND kind='orders' FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO previous FROM public.phif_order_snapshots WHERE pharmacy_id=p_pharmacy_id FOR UPDATE;
  IF op.status='completed' THEN RETURN previous.version; END IF;
  IF op.status<>'pending' OR op.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'PHIF_SYNC_LEASE_EXPIRED'; END IF;
  IF COALESCE(previous.version,0) IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Version conflict'; END IF;
  IF p_report IS NULL OR p_report->>'complete' IS DISTINCT FROM 'true' OR jsonb_typeof(p_report->'orders') IS DISTINCT FROM 'array'
    OR p_report->>'totalOrders' IS NULL OR (p_report->>'totalOrders')::integer<>jsonb_array_length(p_report->'orders')
    OR octet_length(p_report::text)>20000000 THEN RAISE EXCEPTION 'Incomplete order read'; END IF;
  IF p_report-ARRAY['pharmacy','complete','totalOrders','pages','excludedZero','fetchedAt','orders']<>'{}'::jsonb
    OR p_report->>'pharmacy' IS DISTINCT FROM (SELECT name FROM public.pharmacies WHERE id=p_pharmacy_id)
    OR jsonb_typeof(p_report->'pages') IS DISTINCT FROM 'number' OR (p_report->>'pages')::integer<1
    OR jsonb_typeof(p_report->'excludedZero') IS DISTINCT FROM 'number' OR (p_report->>'excludedZero')::integer<0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'orders') o WHERE
      o-ARRAY['id','number','createdAt','status','detailError','lines']<>'{}'::jsonb
      OR jsonb_typeof(o->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(o->'number') IS DISTINCT FROM 'string'
      OR jsonb_typeof(o->'status') IS DISTINCT FROM 'string'
      OR (jsonb_typeof(o->'createdAt') IS DISTINCT FROM 'string' AND jsonb_typeof(o->'createdAt') IS DISTINCT FROM 'null')
      OR jsonb_typeof(o->'lines') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'Invalid order fields'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'orders') o CROSS JOIN LATERAL jsonb_array_elements(o->'lines') l
    WHERE l-ARRAY['id','medicine','supplier','batch','approval','approvedQuantity','quantityMissing','status','approvedAt','receivedAt']<>'{}'::jsonb
      OR jsonb_typeof(l->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(l->'medicine') IS DISTINCT FROM 'string'
      OR jsonb_typeof(l->'approval') IS DISTINCT FROM 'string' OR jsonb_typeof(l->'status') IS DISTINCT FROM 'string'
      OR (jsonb_typeof(l->'supplier') IS DISTINCT FROM 'string' AND jsonb_typeof(l->'supplier') IS DISTINCT FROM 'null')
      OR (jsonb_typeof(l->'batch') IS DISTINCT FROM 'string' AND jsonb_typeof(l->'batch') IS DISTINCT FROM 'null')
      OR (jsonb_typeof(l->'receivedAt') IS DISTINCT FROM 'string' AND jsonb_typeof(l->'receivedAt') IS DISTINCT FROM 'null')
      OR jsonb_typeof(l->'quantityMissing') IS DISTINCT FROM 'boolean'
      OR (jsonb_typeof(l->'approvedQuantity') IS DISTINCT FROM 'null' AND
        (jsonb_typeof(l->'approvedQuantity') IS DISTINCT FROM 'number' OR (l->>'approvedQuantity')::numeric<=0))
      OR l->>'approvedAt' IS NOT NULL) THEN RAISE EXCEPTION 'Invalid order line fields'; END IF;
  fetched := (p_report->>'fetchedAt')::timestamptz;
  IF fetched IS NULL OR fetched<op.started_at-interval '5 seconds' OR fetched>clock_timestamp()+interval '5 seconds'
    OR fetched<previous.fetched_at THEN RAISE EXCEPTION 'Stale order read'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(previous.report->'orders') old_order
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_report->'orders') new_order WHERE new_order->>'id'=old_order->>'id'))
    THEN RAISE EXCEPTION 'Incomplete orders; existing order omitted'; END IF;
  -- Receipt observations and the complete snapshot commit or roll back together.
  -- The installed observer treats equal timestamps as a no-op. Never publish a
  -- different report while its receipt observations would be skipped.
  PERFORM pg_advisory_xact_lock(hashtextextended('phif-order-receipts:'||p_pharmacy_id::text,0));
  SELECT fetched_at INTO observed_at FROM public.phif_order_receipt_sync WHERE pharmacy_id=p_pharmacy_id;
  IF fetched<=observed_at THEN RAISE EXCEPTION 'Stale order read: receipt timestamp already observed'; END IF;
  PERFORM public.observe_phif_order_receipts(p_pharmacy_id,p_actor_id,p_report);
  v := COALESCE(previous.version,0)+1;
  INSERT INTO public.phif_order_snapshots(pharmacy_id,report,version,fetched_at,saved_by)
    VALUES(p_pharmacy_id,p_report,v,fetched,p_actor_id)
    ON CONFLICT(pharmacy_id) DO UPDATE SET report=EXCLUDED.report,version=EXCLUDED.version,
      fetched_at=EXCLUDED.fetched_at,saved_by=EXCLUDED.saved_by,saved_at=clock_timestamp();
  UPDATE public.phif_manual_sync_operations SET status='completed',finished_at=clock_timestamp() WHERE id=op.id;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,p_actor_id,'phif_orders_snapshot_saved','phif_manual_sync_operations',op.id,
      jsonb_build_object('version',v,'orders',p_report->'totalOrders'));
  RETURN v;
END $$;

-- Fence every stock writer, including calls from a previous app deployment.
ALTER FUNCTION public.replace_phif_stock_snapshots(uuid,uuid,jsonb) RENAME TO _apply_phif_stock_snapshots;
REVOKE ALL ON FUNCTION public._apply_phif_stock_snapshots(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public._apply_phif_stock_snapshots(uuid,uuid,jsonb) SET search_path=pg_catalog,pg_temp;
CREATE FUNCTION public.replace_phif_stock_snapshots(p_pharmacy_id uuid,p_sync_run_id uuid,p_items jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE op public.phif_manual_sync_operations; imported integer; n integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('phif-manual-sync:'||p_pharmacy_id::text,0));
  SELECT * INTO op FROM public.phif_manual_sync_operations WHERE id=p_sync_run_id AND pharmacy_id=p_pharmacy_id AND kind='stock' FOR UPDATE;
  IF op.id IS NULL THEN RAISE EXCEPTION 'PHIF_LEGACY_PENDING_REQUIRES_REVIEW'; END IF;
  PERFORM public._phif_manual_sync_actor(p_pharmacy_id,op.actor_id);
  IF op.status='completed' THEN
    SELECT imported_records INTO imported FROM public.phif_stock_sync_runs WHERE id=op.id AND pharmacy_id=p_pharmacy_id AND status='completed';
    RETURN imported;
  END IF;
  IF op.status<>'pending' OR op.expires_at<=clock_timestamp() OR NOT EXISTS(
    SELECT 1 FROM public.phif_stock_sync_runs WHERE id=op.id AND pharmacy_id=p_pharmacy_id AND status='pending'
  ) THEN RAISE EXCEPTION 'PHIF_SYNC_LEASE_EXPIRED'; END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid stock payload'; END IF;
  n := jsonb_array_length(p_items);
  IF n<>(SELECT count(DISTINCT x->>'source_stock_id') FROM jsonb_array_elements(p_items) x)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE COALESCE(btrim(x->>'source_stock_id'),'')=''
      OR COALESCE(btrim(x->>'content_hash'),'')='') THEN RAISE EXCEPTION 'Invalid stock identities'; END IF;
  imported := public._apply_phif_stock_snapshots(p_pharmacy_id,p_sync_run_id,p_items);
  UPDATE public.phif_stock_sync_runs SET status='completed',finished_at=clock_timestamp(),total_records=n,
    imported_records=imported,error_count=0,error_message=NULL WHERE id=op.id AND pharmacy_id=p_pharmacy_id;
  UPDATE public.phif_manual_sync_operations SET status='completed',finished_at=clock_timestamp() WHERE id=op.id;
  INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
    VALUES(p_pharmacy_id,op.actor_id,'phif_stock_sync_completed','phif_manual_sync_operations',op.id,
      jsonb_build_object('records',n,'imported',imported));
  RETURN imported;
END $$;

REVOKE ALL ON FUNCTION public._phif_manual_sync_actor(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.begin_phif_manual_sync(uuid,uuid,text,uuid),public.fail_phif_manual_sync(uuid,uuid,uuid),
  public.complete_phif_orders_sync(uuid,uuid,uuid,integer,jsonb),public.replace_phif_stock_snapshots(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.begin_phif_manual_sync(uuid,uuid,text,uuid),public.fail_phif_manual_sync(uuid,uuid,uuid),
  public.complete_phif_orders_sync(uuid,uuid,uuid,integer,jsonb),public.replace_phif_stock_snapshots(uuid,uuid,jsonb) TO service_role;
-- Check EFFECTIVE privileges, including inherited ownership and column grants.
-- BYPASSRLS is deliberately not treated as a substitute for object privileges.
DO $privileges$
DECLARE t regclass; f regprocedure; app oid := 'service_role'::regrole;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE oid=app AND (rolsuper OR rolcreaterole)) THEN RAISE EXCEPTION 'Unsafe service role'; END IF;
  FOREACH t IN ARRAY ARRAY['public.phif_order_snapshots'::regclass,'public.phif_manual_sync_operations'::regclass] LOOP
    IF pg_has_role(app,(SELECT relowner FROM pg_class WHERE oid=t),'MEMBER')
      OR has_table_privilege(app,t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege(app,t,'INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Unsafe table write privileges'; END IF;
    IF has_table_privilege('anon',t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_table_privilege('authenticated',t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR has_any_column_privilege('anon',t,'SELECT,INSERT,UPDATE,REFERENCES')
      OR has_any_column_privilege('authenticated',t,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Unsafe table access'; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=t) THEN RAISE EXCEPTION 'RLS is required'; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.begin_phif_manual_sync(uuid,uuid,text,uuid)'::regprocedure,
    'public.fail_phif_manual_sync(uuid,uuid,uuid)'::regprocedure,
    'public.complete_phif_orders_sync(uuid,uuid,uuid,integer,jsonb)'::regprocedure,
    'public.replace_phif_stock_snapshots(uuid,uuid,jsonb)'::regprocedure,
    'public._apply_phif_stock_snapshots(uuid,uuid,jsonb)'::regprocedure,
    'public._phif_manual_sync_actor(uuid,uuid)'::regprocedure] LOOP
    IF pg_has_role(app,(SELECT proowner FROM pg_proc WHERE oid=f),'MEMBER')
      OR has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE')
      OR (SELECT proconfig @> ARRAY['search_path=pg_catalog, pg_temp'] FROM pg_proc WHERE oid=f) IS DISTINCT FROM true
      THEN RAISE EXCEPTION 'Unsafe RPC ownership, grants or search path'; END IF;
  END LOOP;
  IF has_function_privilege(app,'public._apply_phif_stock_snapshots(uuid,uuid,jsonb)'::regprocedure,'EXECUTE')
    OR has_function_privilege(app,'public._phif_manual_sync_actor(uuid,uuid)'::regprocedure,'EXECUTE')
    THEN RAISE EXCEPTION 'Internal helpers must not be service-callable'; END IF;
END $privileges$;
COMMIT;
