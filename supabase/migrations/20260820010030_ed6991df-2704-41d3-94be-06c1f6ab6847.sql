ALTER TABLE public.sms_messages ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;
GRANT ALL ON public.sms_messages TO service_role;
GRANT SELECT, UPDATE ON public.sms_messages TO authenticated;
