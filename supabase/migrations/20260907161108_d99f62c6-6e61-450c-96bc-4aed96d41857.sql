-- P1: Medication Identity & Prescription Foundation (additive only)

CREATE TABLE public.medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  active_ingredient text NOT NULL,
  active_ingredient_normalized text NOT NULL,
  strength_value numeric NOT NULL,
  strength_unit text NOT NULL,
  strength_denominator_value numeric NULL,
  strength_denominator_unit text NULL,
  dosage_form text NOT NULL,
  dosage_form_normalized text NOT NULL,
  route text NULL,
  atc_code text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medications_ingredient_not_blank CHECK (length(btrim(active_ingredient_normalized)) > 0),
  CONSTRAINT medications_dosage_form_not_blank CHECK (length(btrim(dosage_form_normalized)) > 0),
  CONSTRAINT medications_strength_positive CHECK (strength_value > 0),
  CONSTRAINT medications_denominator_pair CHECK (
    (strength_denominator_value IS NULL AND strength_denominator_unit IS NULL)
    OR (strength_denominator_value IS NOT NULL AND strength_denominator_unit IS NOT NULL AND strength_denominator_value > 0)
  )
);

CREATE UNIQUE INDEX medications_identity_uidx ON public.medications (
  active_ingredient_normalized,
  strength_value,
  strength_unit,
  COALESCE(strength_denominator_value, -1),
  COALESCE(strength_denominator_unit, ''),
  dosage_form_normalized,
  COALESCE(route, '')
);
CREATE INDEX medications_ingredient_idx ON public.medications (active_ingredient_normalized);
CREATE INDEX medications_atc_idx ON public.medications (atc_code) WHERE atc_code IS NOT NULL;

GRANT ALL ON public.medications TO service_role;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.commercial_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name text NOT NULL,
  brand_name_normalized text NOT NULL,
  manufacturer text NULL,
  supplier text NULL,
  package_size numeric NULL,
  package_unit text NULL,
  barcode text NULL,
  phif_code text NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_products_brand_not_blank CHECK (length(btrim(brand_name_normalized)) > 0),
  CONSTRAINT commercial_products_package_size_positive CHECK (package_size IS NULL OR package_size > 0)
);

CREATE UNIQUE INDEX commercial_products_barcode_uidx ON public.commercial_products (barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX commercial_products_phif_code_uidx ON public.commercial_products (phif_code) WHERE phif_code IS NOT NULL;
CREATE INDEX commercial_products_brand_manufacturer_idx ON public.commercial_products (brand_name_normalized, manufacturer);

GRANT ALL ON public.commercial_products TO service_role;
ALTER TABLE public.commercial_products ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.product_medication_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.commercial_products(id) ON DELETE RESTRICT,
  medication_id uuid NOT NULL REFERENCES public.medications(id) ON DELETE RESTRICT,
  units_per_package numeric NULL,
  source text NOT NULL,
  confidence text NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz NULL,
  created_by_pharmacy_id uuid NULL REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pmm_source_valid CHECK (source IN ('manual','phif','import')),
  CONSTRAINT pmm_confidence_valid CHECK (confidence IN ('confirmed','proposed')),
  CONSTRAINT pmm_units_positive CHECK (units_per_package IS NULL OR units_per_package > 0),
  CONSTRAINT pmm_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- One active mapping per (product, medication); combination products may have
-- several active mappings for the same product with different medications.
CREATE UNIQUE INDEX pmm_active_product_medication_uidx
  ON public.product_medication_mappings (product_id, medication_id)
  WHERE effective_to IS NULL;
CREATE INDEX pmm_product_idx ON public.product_medication_mappings (product_id);
CREATE INDEX pmm_medication_idx ON public.product_medication_mappings (medication_id);
CREATE INDEX pmm_created_by_pharmacy_idx ON public.product_medication_mappings (created_by_pharmacy_id);

GRANT ALL ON public.product_medication_mappings TO service_role;
ALTER TABLE public.product_medication_mappings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  prescription_date date NOT NULL,
  valid_until date NULL,
  prescriber_name text NULL,
  source text NOT NULL,
  external_ref text NULL,
  status text NOT NULL DEFAULT 'draft',
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescriptions_source_valid CHECK (source IN ('paper','phif','manual')),
  CONSTRAINT prescriptions_status_valid CHECK (status IN ('draft','active','cancelled')),
  CONSTRAINT prescriptions_valid_until_after CHECK (valid_until IS NULL OR valid_until >= prescription_date)
);

CREATE UNIQUE INDEX prescriptions_external_ref_uidx
  ON public.prescriptions (pharmacy_id, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX prescriptions_pharmacy_patient_date_idx
  ON public.prescriptions (pharmacy_id, patient_id, prescription_date DESC);
CREATE INDEX prescriptions_patient_idx ON public.prescriptions (patient_id);

GRANT ALL ON public.prescriptions TO service_role;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  medication_id uuid NULL REFERENCES public.medications(id) ON DELETE RESTRICT,
  raw_text text NOT NULL,
  quantity_prescribed numeric NULL,
  quantity_unit text NULL,
  dose_instructions text NULL,
  days_supply integer NULL,
  line_number integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescription_items_raw_text_not_blank CHECK (length(btrim(raw_text)) > 0),
  CONSTRAINT prescription_items_line_positive CHECK (line_number > 0),
  CONSTRAINT prescription_items_qty_positive CHECK (quantity_prescribed IS NULL OR quantity_prescribed > 0),
  CONSTRAINT prescription_items_days_positive CHECK (days_supply IS NULL OR days_supply > 0)
);

CREATE UNIQUE INDEX prescription_items_line_uidx ON public.prescription_items (prescription_id, line_number);
CREATE INDEX prescription_items_prescription_idx ON public.prescription_items (prescription_id);
CREATE INDEX prescription_items_medication_idx ON public.prescription_items (medication_id);
CREATE INDEX prescription_items_pharmacy_idx ON public.prescription_items (pharmacy_id);

GRANT ALL ON public.prescription_items TO service_role;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

-- Reuse the existing timestamp trigger implementation.
CREATE TRIGGER trg_medications_updated_at BEFORE UPDATE ON public.medications
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_commercial_products_updated_at BEFORE UPDATE ON public.commercial_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_pmm_updated_at BEFORE UPDATE ON public.product_medication_mappings
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_prescriptions_updated_at BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_prescription_items_updated_at BEFORE UPDATE ON public.prescription_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Browser roles get no direct access (P0 security model).
REVOKE ALL ON public.medications FROM anon, authenticated;
REVOKE ALL ON public.commercial_products FROM anon, authenticated;
REVOKE ALL ON public.product_medication_mappings FROM anon, authenticated;
REVOKE ALL ON public.prescriptions FROM anon, authenticated;
REVOKE ALL ON public.prescription_items FROM anon, authenticated;