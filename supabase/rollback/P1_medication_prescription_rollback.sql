-- P1 ROLLBACK (prepared, NOT applied)
-- Drops the five P1 foundation tables in reverse dependency order.
-- Touches nothing else: no existing production table, function, trigger,
-- view, grant, or row is affected.

DROP TABLE IF EXISTS public.prescription_items;
DROP TABLE IF EXISTS public.prescriptions;
DROP TABLE IF EXISTS public.product_medication_mappings;
DROP TABLE IF EXISTS public.commercial_products;
DROP TABLE IF EXISTS public.medications;

-- Indexes and triggers are dropped together with their tables.
-- public.tg_touch_updated_at() is shared and must NOT be dropped.
