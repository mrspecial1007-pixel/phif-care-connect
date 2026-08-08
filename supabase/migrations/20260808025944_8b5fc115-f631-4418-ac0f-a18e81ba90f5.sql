ALTER TABLE public.communication_logs ADD COLUMN IF NOT EXISTS patient_status TEXT;
ALTER TABLE public.communication_logs ADD COLUMN IF NOT EXISTS remaining_days INTEGER;
