-- 1. Secure Pairing Codes Table
CREATE TABLE IF NOT EXISTS public.gateway_pairing_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pharmacy_id UUID NOT NULL REFERENCES public.pharmacies(id),
    code_hash TEXT NOT NULL UNIQUE, -- SHA-256 of the pairing code
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. Add revocation to Gateway Devices
ALTER TABLE public.gateway_devices ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- 3. RLS & Grants
ALTER TABLE public.gateway_pairing_codes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gateway_pairing_codes TO authenticated;
GRANT ALL ON public.gateway_pairing_codes TO service_role;

-- 4. Atomic Registration Function (Security Definer to bypass RLS and handle atomicity)
CREATE OR REPLACE FUNCTION public.register_gateway_device_with_code(
    _device_name TEXT,
    _code_hash TEXT,
    _fcm_token TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _pharmacy_id UUID;
    _device_id UUID;
    _device_token TEXT;
    _token_hash TEXT;
    _pairing_record RECORD;
BEGIN
    -- 1. Find and lock the pairing code record for update to ensure atomicity
    SELECT * INTO _pairing_record 
    FROM public.gateway_pairing_codes 
    WHERE code_hash = _code_hash 
      AND used_at IS NULL 
      AND expires_at > now()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pairing code is invalid, expired, or already used';
    END IF;

    _pharmacy_id := _pairing_record.pharmacy_id;

    -- 2. Mark code as used
    UPDATE public.gateway_pairing_codes 
    SET used_at = now() 
    WHERE id = _pairing_record.id;

    -- 3. Create Gateway Device
    _device_token := encode(gen_random_bytes(32), 'hex');
    _token_hash := encode(digest(_device_token, 'sha256'), 'hex');

    INSERT INTO public.gateway_devices (
        name,
        pharmacy_id,
        token_hash,
        fcm_token,
        status,
        enabled
    ) VALUES (
        _device_name,
        _pharmacy_id,
        _token_hash,
        _fcm_token,
        'active',
        true
    ) RETURNING id INTO _device_id;

    RETURN json_build_object(
        'deviceId', _device_id,
        'deviceToken', _device_token
    );
END;
$$;
