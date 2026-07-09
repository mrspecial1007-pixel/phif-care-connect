
-- Enums
CREATE TYPE public.cycle_status AS ENUM ('Waiting','Partial','Completed');
CREATE TYPE public.tx_type AS ENUM ('Partial','Remaining','Completed');
CREATE TYPE public.review_status AS ENUM ('ok','needs_review');

-- Pharmacies
CREATE TABLE public.pharmacies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.pharmacies TO service_role;
ALTER TABLE public.pharmacies ENABLE ROW LEVEL SECURITY;
-- Safe columns exposed via view v_pharmacies below.

-- Patients
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name TEXT NOT NULL,
  patient_name_normalized TEXT NOT NULL,
  insurance_card_number TEXT UNIQUE,
  national_id TEXT,
  phone TEXT,
  address TEXT,
  birth_date DATE,
  gender TEXT,
  notes TEXT,
  review_status public.review_status NOT NULL DEFAULT 'ok',
  possible_duplicate_of UUID REFERENCES public.patients(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX patients_name_norm_idx ON public.patients (patient_name_normalized);
CREATE INDEX patients_card_idx ON public.patients (insurance_card_number);
GRANT SELECT ON public.patients TO anon;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read patients" ON public.patients FOR SELECT TO anon USING (true);

-- Dispensing cycles
CREATE TABLE public.dispensing_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status public.cycle_status NOT NULL,
  started_at DATE NOT NULL,
  completed_at DATE,
  next_due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cycles_patient_idx ON public.dispensing_cycles (patient_id);
CREATE INDEX cycles_open_idx ON public.dispensing_cycles (patient_id) WHERE status <> 'Completed';
GRANT SELECT ON public.dispensing_cycles TO anon;
GRANT ALL ON public.dispensing_cycles TO service_role;
ALTER TABLE public.dispensing_cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read cycles" ON public.dispensing_cycles FOR SELECT TO anon USING (true);

-- Dispensing transactions
CREATE TABLE public.dispensing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id UUID NOT NULL REFERENCES public.dispensing_cycles(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id),
  dispensing_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  transaction_type public.tx_type NOT NULL,
  items_dispensed INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tx_patient_idx ON public.dispensing_transactions (patient_id, dispensing_date DESC);
CREATE INDEX tx_pharmacy_idx ON public.dispensing_transactions (pharmacy_id, dispensing_date DESC);
GRANT SELECT ON public.dispensing_transactions TO anon;
GRANT ALL ON public.dispensing_transactions TO service_role;
ALTER TABLE public.dispensing_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read tx" ON public.dispensing_transactions FOR SELECT TO anon USING (true);

-- Audit log (server-only)
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id UUID REFERENCES public.pharmacies(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id UUID,
  before JSONB,
  after JSONB,
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_created_idx ON public.audit_log (created_at DESC);
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
-- No anon policy.

-- Safe pharmacies view (no pin_hash)
CREATE VIEW public.v_pharmacies AS
  SELECT id, name, created_at FROM public.pharmacies;
GRANT SELECT ON public.v_pharmacies TO anon, service_role;

-- Patient status view: derived remaining days, current cycle, last pharmacy, shared flag
CREATE VIEW public.v_patient_status AS
WITH open_cycle AS (
  SELECT DISTINCT ON (patient_id) *
  FROM public.dispensing_cycles
  WHERE status <> 'Completed'
  ORDER BY patient_id, started_at DESC, created_at DESC
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
  oc.id AS current_cycle_id,
  oc.status AS current_cycle_status,
  oc.started_at AS current_cycle_started_at,
  oc.next_due_date,
  CASE
    WHEN oc.next_due_date IS NULL THEN NULL
    ELSE (oc.next_due_date - CURRENT_DATE)
  END AS remaining_days,
  lt.pharmacy_id AS last_pharmacy_id,
  lp.name AS last_pharmacy_name,
  lt.dispensing_date AS last_dispensing_date,
  COALESCE(s.pharmacy_count, 0) AS pharmacy_count,
  (COALESCE(s.pharmacy_count, 0) >= 2) AS is_shared
FROM public.patients p
LEFT JOIN open_cycle oc ON oc.patient_id = p.id
LEFT JOIN last_tx lt ON lt.patient_id = p.id
LEFT JOIN public.pharmacies lp ON lp.id = lt.pharmacy_id
LEFT JOIN shared s ON s.patient_id = p.id;
GRANT SELECT ON public.v_patient_status TO anon, service_role;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE TRIGGER trg_cycles_updated_at BEFORE UPDATE ON public.dispensing_cycles
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
