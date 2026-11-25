-- Previous deployed function definition. Run only under the documented rollback plan.
BEGIN;
CREATE OR REPLACE FUNCTION public.complete_phif_orders_sync(p_pharmacy_id uuid,p_actor_id uuid,p_operation_id uuid,p_expected_version integer,p_report jsonb)
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
COMMIT;
