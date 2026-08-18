DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_status') THEN
        CREATE TYPE public.sms_status AS ENUM ('pending', 'sending', 'sent', 'delivered', 'failed', 'cancelled');
    END IF;
END $$;

-- 1. Logical SMS Messages
CREATE TABLE IF NOT EXISTS public.sms_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.patients(id),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id),
    phone_number TEXT NOT NULL,
    message_body TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    current_status public.sms_status DEFAULT 'pending' NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    created_by UUID NOT NULL REFERENCES public.pharmacies(id),
    UNIQUE (pharmacy_id, idempotency_key)
);

-- 2. Gateway Devices (Authorized hardware)
CREATE TABLE IF NOT EXISTS public.gateway_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id),
    token_hash TEXT NOT NULL, -- SHA256(device_token)
    fcm_token TEXT, -- For wake-up signals
    status TEXT DEFAULT 'active' NOT NULL,
    last_seen_at TIMESTAMPTZ,
    enabled BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. SMS Send Attempts (Physical SIM attempts)
CREATE TABLE IF NOT EXISTS public.sms_send_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES public.sms_messages(id) ON DELETE CASCADE,
    attempt_number INT NOT NULL DEFAULT 1,
    gateway_device_id UUID REFERENCES public.gateway_devices(id),
    sim_slot INT CHECK (sim_slot IN (1, 2)),
    requested_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    claimed_at TIMESTAMPTZ,
    lease_expires_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- RLS & GRANTS
ALTER TABLE public.sms_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gateway_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_send_attempts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;

GRANT SELECT ON public.gateway_devices TO authenticated;
GRANT ALL ON public.gateway_devices TO service_role;

GRANT SELECT ON public.sms_send_attempts TO authenticated;
GRANT ALL ON public.sms_send_attempts TO service_role;

-- Policies (Simplified for Pharmacy PIN sessions which use service_role/admin for most reads)
CREATE POLICY "Pharmacy access" ON public.sms_messages FOR ALL TO authenticated USING (true);
CREATE POLICY "Gateway access" ON public.gateway_devices FOR ALL TO authenticated USING (true);
CREATE POLICY "Attempt access" ON public.sms_send_attempts FOR ALL TO authenticated USING (true);
