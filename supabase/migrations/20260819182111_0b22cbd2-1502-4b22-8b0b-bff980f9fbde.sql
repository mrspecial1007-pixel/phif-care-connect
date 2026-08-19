DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sms_status' AND 'handoff' = ANY(enum_range(NULL::sms_status)::text[])) THEN
        ALTER TYPE public.sms_status ADD VALUE 'handoff';
    END IF;
END
$$;

COMMENT ON COLUMN public.sms_messages.current_status IS 'Current delivery status. handoff indicates a manual browser redirection to an external SMS app.';