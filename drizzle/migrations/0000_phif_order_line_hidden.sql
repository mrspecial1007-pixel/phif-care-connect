CREATE TABLE public.phif_order_line_hidden (
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id),
  order_id text NOT NULL,
  line_id text NOT NULL,
  batch text NOT NULL DEFAULT '',
  hidden_by uuid,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pharmacy_id, order_id, line_id, batch)
);
GRANT ALL ON public.phif_order_line_hidden TO service_role;
ALTER TABLE public.phif_order_line_hidden ENABLE ROW LEVEL SECURITY;