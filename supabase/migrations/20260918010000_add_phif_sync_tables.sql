-- Phase 1 PHIF sync foundation.
-- Additive only: these tables store PHIF-imported invoice snapshots without
-- mutating existing patients, dispensing transactions, cycles, or due tracks.

CREATE TABLE public.phif_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  status text NOT NULL DEFAULT 'pending',
  new_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phif_sync_runs_status_valid CHECK (status IN ('pending','completed','failed')),
  CONSTRAINT phif_sync_runs_counts_nonnegative CHECK (
    new_count >= 0 AND duplicate_count >= 0 AND failed_count >= 0
  )
);

CREATE INDEX phif_sync_runs_pharmacy_started_idx
  ON public.phif_sync_runs (pharmacy_id, started_at DESC);

CREATE TABLE public.phif_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  sync_run_id uuid NULL REFERENCES public.phif_sync_runs(id) ON DELETE SET NULL,
  invoice_key text NOT NULL,
  invoice_number text NULL,
  insurance_card_number text NULL,
  beneficiary_name text NULL,
  dispensing_date date NULL,
  dispensing_time time NULL,
  status text NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phif_invoices_invoice_key_not_blank CHECK (length(btrim(invoice_key)) > 0)
);

CREATE UNIQUE INDEX phif_invoices_pharmacy_invoice_key_uidx
  ON public.phif_invoices (pharmacy_id, invoice_key);
CREATE INDEX phif_invoices_pharmacy_synced_idx
  ON public.phif_invoices (pharmacy_id, synced_at DESC);
CREATE INDEX phif_invoices_card_idx
  ON public.phif_invoices (insurance_card_number) WHERE insurance_card_number IS NOT NULL;

CREATE TABLE public.phif_invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phif_invoice_id uuid NOT NULL REFERENCES public.phif_invoices(id) ON DELETE CASCADE,
  phif_item_id text NULL,
  active_ingredient text NULL,
  strength text NULL,
  brand text NULL,
  quantity numeric NULL,
  supplier text NULL,
  source_classification text NULL,
  phif_financial_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phif_invoice_items_quantity_positive CHECK (quantity IS NULL OR quantity >= 0)
);

CREATE INDEX phif_invoice_items_invoice_idx
  ON public.phif_invoice_items (phif_invoice_id);
CREATE INDEX phif_invoice_items_source_idx
  ON public.phif_invoice_items (source_classification) WHERE source_classification IS NOT NULL;
CREATE INDEX phif_invoice_items_phif_item_idx
  ON public.phif_invoice_items (phif_item_id) WHERE phif_item_id IS NOT NULL;

GRANT ALL ON public.phif_sync_runs TO service_role;
GRANT ALL ON public.phif_invoices TO service_role;
GRANT ALL ON public.phif_invoice_items TO service_role;

ALTER TABLE public.phif_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phif_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phif_invoice_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.phif_sync_runs FROM anon, authenticated;
REVOKE ALL ON public.phif_invoices FROM anon, authenticated;
REVOKE ALL ON public.phif_invoice_items FROM anon, authenticated;
