CREATE TABLE public.communication_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE NOT NULL,
    pharmacy_id uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
    action_type text NOT NULL, -- e.g., 'open_whatsapp', 'open_sms', 'start_call'
    phone_number text NOT NULL,
    channel text NOT NULL, -- 'WhatsApp', 'SMS', 'Call'
    created_at timestamptz DEFAULT now() NOT NULL
);

GRANT SELECT, INSERT ON public.communication_logs TO authenticated;
GRANT ALL ON public.communication_logs TO service_role;

ALTER TABLE public.communication_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can select all logs"
ON public.communication_logs
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX communication_logs_patient_idx ON public.communication_logs(patient_id);
CREATE INDEX communication_logs_created_at_idx ON public.communication_logs(created_at DESC);