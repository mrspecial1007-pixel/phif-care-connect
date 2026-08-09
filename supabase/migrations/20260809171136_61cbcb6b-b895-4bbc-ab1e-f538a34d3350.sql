-- 1. Create the new tracks table
CREATE TABLE public.dispensing_due_tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    source_transaction_id UUID REFERENCES public.dispensing_transactions(id) ON DELETE SET NULL,
    last_dispensing_date DATE NOT NULL,
    next_due_date DATE NOT NULL,
    status public.cycle_status NOT NULL DEFAULT 'Waiting',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_due_tracks_patient ON public.dispensing_due_tracks(patient_id);
CREATE INDEX idx_due_tracks_next_due ON public.dispensing_due_tracks(next_due_date ASC);

GRANT SELECT ON public.dispensing_due_tracks TO anon;
GRANT ALL ON public.dispensing_due_tracks TO service_role;
ALTER TABLE public.dispensing_due_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read due tracks" ON public.dispensing_due_tracks FOR SELECT TO anon USING (true);

-- 2. Migrate existing data: Convert non-completed cycles into tracks
INSERT INTO public.dispensing_due_tracks (patient_id, last_dispensing_date, next_due_date, status, created_at)
SELECT 
    patient_id, 
    COALESCE(completed_at, started_at), 
    next_due_date, 
    status,
    created_at
FROM public.dispensing_cycles
WHERE status <> 'Completed' AND next_due_date IS NOT NULL;

-- 3. Update v_patient_status view
DROP VIEW IF EXISTS public.v_patient_status;
CREATE OR REPLACE VIEW public.v_patient_status AS
WITH track_stats AS (
    SELECT 
        patient_id,
        MIN(next_due_date) as nearest_due_date,
        COUNT(*) as active_tracks_count
    FROM public.dispensing_due_tracks
    WHERE status <> 'Completed'
    GROUP BY patient_id
),
last_tx AS (
  SELECT DISTINCT ON (patient_id) patient_id, pharmacy_id, dispensing_date
  FROM public.dispensing_transactions
  ORDER BY patient_id, dispensing_date DESC
),
shared AS (
  SELECT patient_id, COUNT(DISTINCT pharmacy_id) AS pharmacy_count
  FROM public.dispensing_transactions
  GROUP BY patient_id
)
SELECT
  p.id AS patient_id,
  p.patient_name,
  p.insurance_card_number,
  p.national_id,
  p.phone,
  p.review_status,
  p.is_favorite,
  ts.nearest_due_date AS next_due_date,
  CASE
    WHEN ts.nearest_due_date IS NULL THEN NULL
    ELSE (ts.nearest_due_date - CURRENT_DATE)
  END AS remaining_days,
  ts.active_tracks_count,
  lt.pharmacy_id AS last_pharmacy_id,
  lp.name AS last_pharmacy_name,
  lt.dispensing_date AS last_dispensing_date,
  COALESCE(s.pharmacy_count, 0) AS pharmacy_count,
  (COALESCE(s.pharmacy_count, 0) >= 2) AS is_shared
FROM public.patients p
LEFT JOIN track_stats ts ON ts.patient_id = p.id
LEFT JOIN last_tx lt ON lt.patient_id = p.id
LEFT JOIN public.pharmacies lp ON lp.id = lt.pharmacy_id
LEFT JOIN shared s ON s.patient_id = p.id;

ALTER VIEW public.v_patient_status SET (security_invoker = on);
GRANT SELECT ON public.v_patient_status TO anon, service_role;

-- 4. Trigger for updated_at
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_due_tracks_updated_at BEFORE UPDATE ON public.dispensing_due_tracks
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
