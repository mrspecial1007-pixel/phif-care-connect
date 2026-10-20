-- Apply manually after the pharmacy users/operation log and PHIF stock migrations.
-- No imported invoice, patient, dispensing or stock rows are changed.
BEGIN;
CREATE TABLE public.phif_actual_stock_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  phif_invoice_item_id uuid NOT NULL REFERENCES public.phif_invoice_items(id),
  target_stock_item_id uuid NOT NULL REFERENCES public.phif_stock_items(id),
  source_signature text NOT NULL CHECK (length(source_signature) > 0),
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES public.pharmacy_users(id),
  updated_actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phif_actual_stock_links_item_unique UNIQUE (pharmacy_id, phif_invoice_item_id)
);
ALTER TABLE public.phif_actual_stock_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_actual_stock_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.phif_actual_stock_links TO service_role;

CREATE FUNCTION public.set_phif_actual_stock_link(
  p_pharmacy_id uuid, p_item_id uuid, p_target_id uuid, p_signature text,
  p_expected_version integer, p_user_id uuid, p_actor text, p_revoke boolean DEFAULT false
) RETURNS public.phif_actual_stock_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing public.phif_actual_stock_links;
  result public.phif_actual_stock_links;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pharmacies WHERE id = p_pharmacy_id AND name = 'صيدلية الترياق الشافي') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pharmacy_users WHERE id = p_user_id AND pharmacy_id = p_pharmacy_id AND role = 'admin' AND is_active
  ) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  -- Serialize changes for this one imported item; this locks but never updates it.
  PERFORM i.id FROM public.phif_invoice_items i JOIN public.phif_invoices f ON f.id = i.phif_invoice_id
    WHERE i.id = p_item_id AND f.pharmacy_id = p_pharmacy_id AND i.source_classification = 'actual-supplier' FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Item unavailable'; END IF;
  SELECT * INTO existing FROM public.phif_actual_stock_links WHERE pharmacy_id = p_pharmacy_id AND phif_invoice_item_id = p_item_id;
  IF coalesce(existing.version, 0) <> p_expected_version THEN RAISE EXCEPTION 'Link changed; reload before saving'; END IF;
  IF p_revoke THEN
    IF existing.id IS NULL OR NOT existing.is_active THEN RETURN existing; END IF;
    UPDATE public.phif_actual_stock_links SET is_active = false, version = version + 1,
      updated_by = p_user_id, updated_actor = p_actor, updated_at = now()
      WHERE id = existing.id RETURNING * INTO result;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.phif_stock_items WHERE id = p_target_id AND pharmacy_id = p_pharmacy_id AND is_current) THEN
      RAISE EXCEPTION 'Current stock unavailable';
    END IF;
    IF existing.is_active AND existing.target_stock_item_id = p_target_id AND existing.source_signature = p_signature THEN RETURN existing; END IF;
    INSERT INTO public.phif_actual_stock_links (pharmacy_id, phif_invoice_item_id, target_stock_item_id, source_signature, updated_by, updated_actor)
      VALUES (p_pharmacy_id, p_item_id, p_target_id, p_signature, p_user_id, p_actor)
    ON CONFLICT (pharmacy_id, phif_invoice_item_id) DO UPDATE SET
      target_stock_item_id = excluded.target_stock_item_id, source_signature = excluded.source_signature,
      is_active = true, version = phif_actual_stock_links.version + 1,
      updated_by = excluded.updated_by, updated_actor = excluded.updated_actor, updated_at = now()
    RETURNING * INTO result;
  END IF;
  -- Audit and decision are committed together; failure rolls both back.
  INSERT INTO public.user_operation_log (pharmacy_id, user_id, action, entity, entity_id, metadata)
    VALUES (p_pharmacy_id, p_user_id, CASE WHEN p_revoke THEN 'actual_stock_link_revoke' ELSE 'actual_stock_link_save' END,
      'phif_actual_stock_link', result.id, jsonb_build_object('actor', p_actor, 'before', to_jsonb(existing), 'after', to_jsonb(result)));
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.set_phif_actual_stock_link(uuid, uuid, uuid, text, integer, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_phif_actual_stock_link(uuid, uuid, uuid, text, integer, uuid, text, boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
