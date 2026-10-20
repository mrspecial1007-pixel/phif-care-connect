-- Apply manually AFTER pharmacy users/operation log, stock, and Actual stock links.
-- Separate, reversible decisions only. Imported invoices/stock are never updated.
BEGIN;
CREATE TABLE public.phif_actual_unit_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  phif_invoice_item_id uuid NOT NULL REFERENCES public.phif_invoice_items(id),
  source_signature text NOT NULL CHECK (length(source_signature) > 0),
  stock_signature text NOT NULL CHECK (length(stock_signature) > 0),
  dispensing_unit text NOT NULL,
  cost_unit text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES public.pharmacy_users(id),
  updated_actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, phif_invoice_item_id),
  CHECK (dispensing_unit IN ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet')),
  CHECK (cost_unit IN ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet'))
);
ALTER TABLE public.phif_actual_unit_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_actual_unit_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.phif_actual_unit_decisions TO service_role;

CREATE FUNCTION public.set_phif_actual_units(p_pharmacy_id uuid, p_user_id uuid, p_actor text,
  p_rows jsonb, p_dispensing_unit text, p_cost_unit text, p_revoke boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  entry jsonb;
  old_row public.phif_actual_unit_decisions;
  new_row public.phif_actual_unit_decisions;
  item_row public.phif_invoice_items;
  stock_row public.phif_stock_items;
  changed integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pharmacies WHERE id=p_pharmacy_id AND name='صيدلية الترياق الشافي')
    OR (p_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.pharmacy_users
      WHERE id=p_user_id AND pharmacy_id=p_pharmacy_id AND role='admin' AND is_active))
    THEN RAISE EXCEPTION 'Forbidden'; END IF;
  -- Null actor ID is permitted only through the service-only, verified legacy manager path.
  IF p_actor IS NULL OR length(trim(p_actor))=0 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid request'; END IF;
  IF (SELECT count(DISTINCT value->>'item_id') FROM jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows)
    THEN RAISE EXCEPTION 'Duplicate items'; END IF;
  -- Stable lock order prevents competing batch approvals from deadlocking.
  FOR entry IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'item_id' LOOP
    SELECT i.* INTO item_row FROM public.phif_invoice_items i JOIN public.phif_invoices f ON f.id=i.phif_invoice_id
      WHERE i.id=(entry->>'item_id')::uuid AND f.pharmacy_id=p_pharmacy_id
      AND i.source_classification='actual-supplier' FOR UPDATE OF i;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item unavailable'; END IF;
    IF jsonb_build_object('brand',item_row.brand,'strength',item_row.strength,'quantity',item_row.quantity,
      'metadata',coalesce(item_row.metadata,'{}'::jsonb),'source_classification',item_row.source_classification) <> entry->'imported'
      THEN RAISE EXCEPTION 'Imported data changed'; END IF;
    SELECT * INTO stock_row FROM public.phif_stock_items WHERE id=(entry->>'stock_id')::uuid
      AND pharmacy_id=p_pharmacy_id AND is_current FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock unavailable'; END IF;
    IF jsonb_build_object('brand_product_id',stock_row.brand_product_id,'source_stock_id',stock_row.source_stock_id,
      'brand_name',stock_row.brand_name,'strength',stock_row.strength,'dosage_unit',stock_row.dosage_unit,
      'package_quantity',stock_row.package_quantity,'strips_quantity',stock_row.strips_quantity) <> entry->'pricing'
      THEN RAISE EXCEPTION 'Stock units changed'; END IF;
    SELECT * INTO old_row FROM public.phif_actual_unit_decisions
      WHERE pharmacy_id=p_pharmacy_id AND phif_invoice_item_id=item_row.id FOR UPDATE;
    IF coalesce(old_row.version,0)<>(entry->>'expected_version')::integer THEN RAISE EXCEPTION 'Decision changed'; END IF;
    IF p_revoke THEN
      IF old_row.id IS NULL OR NOT old_row.is_active THEN CONTINUE; END IF;
      UPDATE public.phif_actual_unit_decisions SET is_active=false,version=version+1,
        updated_by=p_user_id,updated_actor=p_actor,updated_at=now() WHERE id=old_row.id RETURNING * INTO new_row;
    ELSE
      INSERT INTO public.phif_actual_unit_decisions(pharmacy_id,phif_invoice_item_id,source_signature,stock_signature,
        dispensing_unit,cost_unit,updated_by,updated_actor)
      VALUES(p_pharmacy_id,item_row.id,entry->>'source_signature',entry->>'stock_signature',p_dispensing_unit,p_cost_unit,p_user_id,p_actor)
      ON CONFLICT(pharmacy_id,phif_invoice_item_id) DO UPDATE SET
        source_signature=excluded.source_signature,stock_signature=excluded.stock_signature,
        dispensing_unit=excluded.dispensing_unit,cost_unit=excluded.cost_unit,is_active=true,
        version=phif_actual_unit_decisions.version+1,updated_by=excluded.updated_by,updated_actor=excluded.updated_actor,updated_at=now()
      RETURNING * INTO new_row;
    END IF;
    INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
      VALUES(p_pharmacy_id,p_user_id,CASE WHEN p_revoke THEN 'actual_unit_revoke' ELSE 'actual_unit_save' END,
        'phif_actual_unit_decision',new_row.id,jsonb_build_object('actor',p_actor,'before',to_jsonb(old_row),'after',to_jsonb(new_row)));
    changed:=changed+1;
  END LOOP;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.set_phif_actual_units(uuid,uuid,text,jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_actual_units(uuid,uuid,text,jsonb,text,text,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
-- Operational rollback: revoke decisions using the manager screen (audited),
-- then deploy the previous code if needed. Retain table/logs for recovery.
