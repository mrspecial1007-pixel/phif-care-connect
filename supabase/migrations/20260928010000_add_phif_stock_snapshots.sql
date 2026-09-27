-- Phase 1 PHIF stock synchronization.
-- Additive, read-only snapshot storage for PHIF insurance-supplied stock.
-- Does not modify patients, dispensing, due tracks, cycles, or invoice history.

CREATE TABLE public.phif_stock_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  total_records integer NOT NULL DEFAULT 0,
  imported_records integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phif_stock_sync_runs_status_valid CHECK (status IN ('pending','completed','failed')),
  CONSTRAINT phif_stock_sync_runs_counts_nonnegative CHECK (
    total_records >= 0 AND imported_records >= 0 AND error_count >= 0
  )
);

CREATE UNIQUE INDEX phif_stock_sync_runs_one_pending_per_pharmacy_uidx
  ON public.phif_stock_sync_runs (pharmacy_id)
  WHERE status = 'pending';

CREATE INDEX phif_stock_sync_runs_pharmacy_started_idx
  ON public.phif_stock_sync_runs (pharmacy_id, started_at DESC);

CREATE TABLE public.phif_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  sync_run_id uuid NULL REFERENCES public.phif_stock_sync_runs(id) ON DELETE SET NULL,
  source_pharmacy_id text NULL,
  source_stock_id text NOT NULL,
  generic_ingredient_id text NULL,
  supplier_id text NULL,
  brand_product_id text NULL,
  batch_id text NULL,
  brand_name text NULL,
  active_ingredient text NULL,
  strength text NULL,
  dosage_unit text NULL,
  package_quantity numeric NULL,
  strips_quantity numeric NULL,
  stock_quantity numeric NULL,
  source_quantity_unit text NULL,
  batch_number text NULL,
  expiry_date date NULL,
  cost_price numeric(18, 6) NULL,
  sale_price numeric(18, 6) NULL,
  factory_price numeric(18, 6) NULL,
  supplier_name text NULL,
  company_name text NULL,
  content_hash text NOT NULL,
  is_current boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phif_stock_items_source_stock_not_blank CHECK (length(btrim(source_stock_id)) > 0),
  CONSTRAINT phif_stock_items_content_hash_not_blank CHECK (length(btrim(content_hash)) > 0)
);

CREATE UNIQUE INDEX phif_stock_items_snapshot_uidx
  ON public.phif_stock_items (pharmacy_id, source_stock_id, content_hash);

CREATE UNIQUE INDEX phif_stock_items_current_source_uidx
  ON public.phif_stock_items (pharmacy_id, source_stock_id)
  WHERE is_current = true;

CREATE INDEX phif_stock_items_pharmacy_current_idx
  ON public.phif_stock_items (pharmacy_id, is_current, synced_at DESC);

CREATE INDEX phif_stock_items_search_idx
  ON public.phif_stock_items (pharmacy_id, brand_name, active_ingredient, supplier_name)
  WHERE is_current = true;

CREATE OR REPLACE FUNCTION public.replace_phif_stock_snapshots(
  p_pharmacy_id uuid,
  p_sync_run_id uuid,
  p_items jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item record;
  current_hash text;
  snapshot_id uuid;
  imported integer := 0;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_items must be a JSON array';
  END IF;

  FOR item IN
    SELECT *
    FROM jsonb_to_recordset(p_items) AS x(
      source_pharmacy_id text,
      source_stock_id text,
      generic_ingredient_id text,
      supplier_id text,
      brand_product_id text,
      batch_id text,
      brand_name text,
      active_ingredient text,
      strength text,
      dosage_unit text,
      package_quantity numeric,
      strips_quantity numeric,
      stock_quantity numeric,
      source_quantity_unit text,
      batch_number text,
      expiry_date date,
      cost_price numeric,
      sale_price numeric,
      factory_price numeric,
      supplier_name text,
      company_name text,
      content_hash text,
      raw_metadata jsonb
    )
  LOOP
    SELECT content_hash
      INTO current_hash
    FROM public.phif_stock_items
    WHERE pharmacy_id = p_pharmacy_id
      AND source_stock_id = item.source_stock_id
      AND is_current = true;

    IF current_hash = item.content_hash THEN
      CONTINUE;
    END IF;

    SELECT id
      INTO snapshot_id
    FROM public.phif_stock_items
    WHERE pharmacy_id = p_pharmacy_id
      AND source_stock_id = item.source_stock_id
      AND content_hash = item.content_hash;

    IF snapshot_id IS NULL THEN
      INSERT INTO public.phif_stock_items (
        pharmacy_id,
        sync_run_id,
        source_pharmacy_id,
        source_stock_id,
        generic_ingredient_id,
        supplier_id,
        brand_product_id,
        batch_id,
        brand_name,
        active_ingredient,
        strength,
        dosage_unit,
        package_quantity,
        strips_quantity,
        stock_quantity,
        source_quantity_unit,
        batch_number,
        expiry_date,
        cost_price,
        sale_price,
        factory_price,
        supplier_name,
        company_name,
        content_hash,
        is_current,
        raw_metadata
      )
      VALUES (
        p_pharmacy_id,
        p_sync_run_id,
        item.source_pharmacy_id,
        item.source_stock_id,
        item.generic_ingredient_id,
        item.supplier_id,
        item.brand_product_id,
        item.batch_id,
        item.brand_name,
        item.active_ingredient,
        item.strength,
        item.dosage_unit,
        item.package_quantity,
        item.strips_quantity,
        item.stock_quantity,
        item.source_quantity_unit,
        item.batch_number,
        item.expiry_date,
        item.cost_price,
        item.sale_price,
        item.factory_price,
        item.supplier_name,
        item.company_name,
        item.content_hash,
        false,
        COALESCE(item.raw_metadata, '{}'::jsonb)
      )
      RETURNING id INTO snapshot_id;
    END IF;

    UPDATE public.phif_stock_items
      SET is_current = false
    WHERE pharmacy_id = p_pharmacy_id
      AND source_stock_id = item.source_stock_id
      AND is_current = true;

    UPDATE public.phif_stock_items
      SET is_current = true,
          sync_run_id = p_sync_run_id,
          synced_at = now()
    WHERE id = snapshot_id;

    imported := imported + 1;
  END LOOP;

  RETURN imported;
END;
$$;

GRANT ALL ON public.phif_stock_sync_runs TO service_role;
GRANT ALL ON public.phif_stock_items TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_phif_stock_snapshots(uuid, uuid, jsonb) TO service_role;

ALTER TABLE public.phif_stock_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phif_stock_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.phif_stock_sync_runs FROM anon, authenticated;
REVOKE ALL ON public.phif_stock_items FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_phif_stock_snapshots(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
