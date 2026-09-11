-- P1 follow-up: allow same-moment product-medication mapping corrections.
-- The original P1 migration was already applied in production, so this
-- changes only the existing effective range constraint in place.

ALTER TABLE public.product_medication_mappings
  DROP CONSTRAINT IF EXISTS pmm_effective_range;

ALTER TABLE public.product_medication_mappings
  ADD CONSTRAINT pmm_effective_range
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
