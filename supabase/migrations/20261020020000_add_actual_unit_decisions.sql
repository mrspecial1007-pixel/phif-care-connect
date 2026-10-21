-- Apply manually AFTER pharmacy users/operation log, stock, and Actual stock links.
-- Reviewed replacement of this NOT-YET-APPLIED migration. No imported rows change.
BEGIN;
CREATE TABLE public.phif_actual_unit_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  phif_invoice_item_id uuid NOT NULL REFERENCES public.phif_invoice_items(id),
  source_signature text NOT NULL CHECK (jsonb_typeof(source_signature::jsonb) = 'object'),
  stock_signature text NOT NULL CHECK (jsonb_typeof(stock_signature::jsonb) = 'object'),
  dispensing_unit text NOT NULL,
  cost_unit text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES public.pharmacy_users(id),
  updated_actor text NOT NULL CHECK (length(btrim(updated_actor)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, phif_invoice_item_id),
  CHECK (dispensing_unit IN ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet')),
  CHECK (cost_unit IN ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet'))
);
ALTER TABLE public.phif_actual_unit_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_actual_unit_decisions FROM PUBLIC, anon, authenticated, service_role;
-- All writes pass through the audited RPC, including service-role application writes.
GRANT SELECT ON public.phif_actual_unit_decisions TO service_role;

CREATE FUNCTION public.phif_actual_canonical_unit(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE regexp_replace(lower(btrim(p_value)), '[._\s-]+', '', 'g')
    WHEN 'tab' THEN 'tablet' WHEN 'tabs' THEN 'tablet' WHEN 'tablet' THEN 'tablet' WHEN 'tablets' THEN 'tablet' WHEN 'قرص' THEN 'tablet' WHEN 'أقراص' THEN 'tablet'
    WHEN 'cap' THEN 'capsule' WHEN 'caps' THEN 'capsule' WHEN 'capsule' THEN 'capsule' WHEN 'capsules' THEN 'capsule' WHEN 'كبسولة' THEN 'capsule'
    WHEN 'strip' THEN 'strip' WHEN 'strips' THEN 'strip' WHEN 'شريط' THEN 'strip'
    WHEN 'box' THEN 'box' WHEN 'boxes' THEN 'box' WHEN 'علبة' THEN 'box'
    WHEN 'pen' THEN 'pen' WHEN 'pens' THEN 'pen' WHEN 'قلم' THEN 'pen'
    WHEN 'vial' THEN 'vial' WHEN 'vials' THEN 'vial' WHEN 'فيال' THEN 'vial'
    WHEN 'amp' THEN 'ampoule' WHEN 'ampoule' THEN 'ampoule' WHEN 'ampoules' THEN 'ampoule' WHEN 'ampul' THEN 'ampoule' WHEN 'أمبول' THEN 'ampoule'
    WHEN 'bottle' THEN 'bottle' WHEN 'bottles' THEN 'bottle' WHEN 'عبوة' THEN 'bottle'
    WHEN 'drop' THEN 'drops' WHEN 'drops' THEN 'drops' WHEN 'eyedrops' THEN 'drops' WHEN 'قطرات' THEN 'drops'
    WHEN 'inhaler' THEN 'inhaler' WHEN 'spray' THEN 'inhaler' WHEN 'بخاخ' THEN 'inhaler'
    WHEN 'tube' THEN 'tube' WHEN 'tubes' THEN 'tube' WHEN 'أنبوب' THEN 'tube'
    WHEN 'ml' THEN 'ml' WHEN 'مل' THEN 'ml'
    WHEN 'g' THEN 'gram' WHEN 'gm' THEN 'gram' WHEN 'gram' THEN 'gram' WHEN 'غرام' THEN 'gram'
    WHEN 'sachet' THEN 'sachet' WHEN 'sachets' THEN 'sachet' WHEN 'كيس' THEN 'sachet'
    ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.phif_actual_canonical_unit(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.phif_actual_canonical_unit(text) TO service_role;

CREATE FUNCTION public.set_phif_actual_units(p_pharmacy_id uuid, p_user_id uuid, p_actor text,
  p_rows jsonb, p_dispensing_unit text, p_cost_unit text, p_revoke boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  entry jsonb;
  old_row public.phif_actual_unit_decisions;
  new_row public.phif_actual_unit_decisions;
  item_row public.phif_invoice_items;
  stock_row public.phif_stock_items;
  actor_name text;
  source_snapshot jsonb;
  stock_snapshot jsonb;
  source_group jsonb;
  batch_group jsonb;
  batch_stock jsonb;
  link_version integer;
  stock_unit text;
  recorded_unit text;
  changed integer := 0;
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.pharmacies WHERE id=p_pharmacy_id AND name='صيدلية الترياق الشافي')
    THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT display_name INTO actor_name FROM public.pharmacy_users
    WHERE id=p_user_id AND pharmacy_id=p_pharmacy_id AND role='admin' AND is_active FOR SHARE;
  IF NOT FOUND OR p_actor IS DISTINCT FROM actor_name THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_revoke IS NULL OR p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'Invalid request'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
  IF p_dispensing_unit IS NULL OR p_cost_unit IS NULL
    OR p_dispensing_unit NOT IN ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet')
    OR p_cost_unit NOT IN ('tablet','capsule','strip','box','pen','vial','ampoule','bottle','drops','inhaler','tube','ml','gram','sachet')
    THEN RAISE EXCEPTION 'Invalid units'; END IF;
  IF (SELECT count(DISTINCT value->>'item_id') FROM jsonb_array_elements(p_rows)) <> jsonb_array_length(p_rows)
    THEN RAISE EXCEPTION 'Duplicate or missing items'; END IF;
  -- Locks follow a stable order. Any failed row rolls back the entire batch and its audit logs.
  FOR entry IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'item_id' LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
      OR jsonb_typeof(entry->'expected_version') IS DISTINCT FROM 'number'
      OR jsonb_typeof(entry->'expected_link_version') IS DISTINCT FROM 'number'
      OR (entry->>'expected_version')::integer < 0 OR (entry->>'expected_link_version')::integer < 0
      THEN RAISE EXCEPTION 'Invalid row'; END IF;
    SELECT i.* INTO item_row FROM public.phif_invoice_items i JOIN public.phif_invoices f ON f.id=i.phif_invoice_id
      WHERE i.id=(entry->>'item_id')::uuid AND f.pharmacy_id=p_pharmacy_id
      AND i.source_classification='actual-supplier' FOR UPDATE OF i;
    IF NOT FOUND THEN RAISE EXCEPTION 'Item unavailable'; END IF;
    source_snapshot := jsonb_build_object('brand',item_row.brand,'strength',item_row.strength,'quantity',item_row.quantity,
      'metadata',item_row.metadata,'source_classification',item_row.source_classification,
      'financial_units',jsonb_build_object('quantity_unit',item_row.phif_financial_fields->'quantity_unit','unit',item_row.phif_financial_fields->'unit'));
    IF source_snapshot IS DISTINCT FROM entry->'imported'
      OR source_snapshot IS DISTINCT FROM (entry->>'source_signature')::jsonb
      THEN RAISE EXCEPTION 'Imported signature changed or missing'; END IF;
    source_group := source_snapshot - 'quantity';
    IF batch_group IS NULL THEN batch_group := source_group;
    ELSIF batch_group IS DISTINCT FROM source_group THEN RAISE EXCEPTION 'Incompatible batch items'; END IF;
    SELECT version INTO link_version FROM public.phif_actual_stock_links
      WHERE pharmacy_id=p_pharmacy_id AND phif_invoice_item_id=item_row.id AND is_active;
    IF coalesce(link_version,0) IS DISTINCT FROM (entry->>'expected_link_version')::integer THEN RAISE EXCEPTION 'Stock link changed'; END IF;
    SELECT * INTO stock_row FROM public.phif_stock_items WHERE id=(entry->>'stock_id')::uuid
      AND pharmacy_id=p_pharmacy_id AND is_current FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock unavailable'; END IF;
    IF jsonb_build_object('brand_product_id',stock_row.brand_product_id,'source_stock_id',stock_row.source_stock_id,
      'brand_name',stock_row.brand_name,'strength',stock_row.strength,'dosage_unit',stock_row.dosage_unit,
      'package_quantity',stock_row.package_quantity,'strips_quantity',stock_row.strips_quantity) IS DISTINCT FROM entry->'pricing'
      THEN RAISE EXCEPTION 'Stock snapshot changed or missing'; END IF;
    stock_snapshot := jsonb_build_object('product_reference',coalesce(nullif(stock_row.brand_product_id,''),stock_row.source_stock_id),
      'brand_name',stock_row.brand_name,'strength',stock_row.strength,'dosage_unit',stock_row.dosage_unit,
      'package_quantity',stock_row.package_quantity,'strips_quantity',stock_row.strips_quantity);
    IF stock_snapshot IS DISTINCT FROM (entry->>'stock_signature')::jsonb THEN RAISE EXCEPTION 'Stock signature changed or missing'; END IF;
    IF batch_stock IS NULL THEN batch_stock := stock_snapshot;
    ELSIF batch_stock IS DISTINCT FROM stock_snapshot THEN RAISE EXCEPTION 'Incompatible stock products'; END IF;
    IF NOT p_revoke THEN
      FOR recorded_unit IN SELECT value FROM jsonb_array_elements_text(jsonb_build_array(
        item_row.metadata->>'quantity_unit',item_row.metadata->>'quantityUnit',item_row.metadata->>'unit',
        item_row.phif_financial_fields->>'quantity_unit',item_row.phif_financial_fields->>'unit'))
        WHERE value IS NOT NULL AND value <> '' LOOP
        IF public.phif_actual_canonical_unit(recorded_unit) IS DISTINCT FROM p_dispensing_unit
          THEN RAISE EXCEPTION 'Conflicting source quantity unit'; END IF;
      END LOOP;
      stock_unit := public.phif_actual_canonical_unit(stock_row.dosage_unit);
      -- TABS cost_price is per tablet, never per box/strip. INJ/CREAM alone is insufficient.
      IF stock_unit IS NULL OR stock_unit IS DISTINCT FROM p_cost_unit THEN RAISE EXCEPTION 'Unverified cost unit'; END IF;
      IF p_dispensing_unit <> p_cost_unit THEN
        IF stock_unit NOT IN ('tablet','capsule') OR p_dispensing_unit NOT IN ('box','strip')
          OR stock_row.package_quantity IS NULL OR stock_row.package_quantity <= 0
          OR stock_row.package_quantity <> trunc(stock_row.package_quantity)
          OR stock_row.package_quantity > 9007199254740991 THEN RAISE EXCEPTION 'Undocumented conversion'; END IF;
        IF p_dispensing_unit='strip' AND (stock_row.strips_quantity IS NULL OR stock_row.strips_quantity <= 0
          OR stock_row.strips_quantity <> trunc(stock_row.strips_quantity)
          OR stock_row.strips_quantity > 9007199254740991
          OR mod(stock_row.package_quantity,stock_row.strips_quantity) <> 0)
          THEN RAISE EXCEPTION 'Undocumented strip conversion'; END IF;
      END IF;
    END IF;
    SELECT * INTO old_row FROM public.phif_actual_unit_decisions
      WHERE pharmacy_id=p_pharmacy_id AND phif_invoice_item_id=item_row.id FOR UPDATE;
    IF coalesce(old_row.version,0) IS DISTINCT FROM (entry->>'expected_version')::integer THEN RAISE EXCEPTION 'Decision changed'; END IF;
    IF p_revoke THEN
      IF old_row.id IS NULL OR NOT old_row.is_active THEN CONTINUE; END IF;
      UPDATE public.phif_actual_unit_decisions SET is_active=false,version=version+1,
        updated_by=p_user_id,updated_actor=actor_name,updated_at=now() WHERE id=old_row.id RETURNING * INTO new_row;
    ELSE
      INSERT INTO public.phif_actual_unit_decisions(pharmacy_id,phif_invoice_item_id,source_signature,stock_signature,
        dispensing_unit,cost_unit,updated_by,updated_actor)
      VALUES(p_pharmacy_id,item_row.id,source_snapshot::text,stock_snapshot::text,p_dispensing_unit,p_cost_unit,p_user_id,actor_name)
      ON CONFLICT(pharmacy_id,phif_invoice_item_id) DO UPDATE SET
        source_signature=excluded.source_signature,stock_signature=excluded.stock_signature,
        dispensing_unit=excluded.dispensing_unit,cost_unit=excluded.cost_unit,is_active=true,
        version=phif_actual_unit_decisions.version+1,updated_by=excluded.updated_by,updated_actor=excluded.updated_actor,updated_at=now()
      RETURNING * INTO new_row;
    END IF;
    INSERT INTO public.user_operation_log(pharmacy_id,user_id,action,entity,entity_id,metadata)
      VALUES(p_pharmacy_id,p_user_id,CASE WHEN p_revoke THEN 'actual_unit_revoke' ELSE 'actual_unit_save' END,
        'phif_actual_unit_decision',new_row.id,jsonb_build_object('actor',actor_name,'before',to_jsonb(old_row),'after',to_jsonb(new_row)));
    changed:=changed+1;
  END LOOP;
  RETURN changed;
END;
$$;
REVOKE ALL ON FUNCTION public.set_phif_actual_units(uuid,uuid,text,jsonb,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_actual_units(uuid,uuid,text,jsonb,text,text,boolean) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
-- Roll back operationally through audited revocation by a registered manager;
-- retain the table and operation log. Never delete imported rows to roll back.
