-- PHIF Tracker: Tiryaq staff users and permissions.
-- Additive only. No default passwords or bootstrap users are created here.

CREATE TABLE IF NOT EXISTS public.pharmacy_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  login_identifier text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'employee',
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NULL,
  CONSTRAINT pharmacy_users_role_valid CHECK (role IN ('admin','employee')),
  CONSTRAINT pharmacy_users_login_not_blank CHECK (length(btrim(login_identifier)) > 0),
  CONSTRAINT pharmacy_users_display_name_not_blank CHECK (length(btrim(display_name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pharmacy_users_pharmacy_login_uidx
  ON public.pharmacy_users (pharmacy_id, lower(btrim(login_identifier)));

CREATE INDEX IF NOT EXISTS pharmacy_users_pharmacy_active_idx
  ON public.pharmacy_users (pharmacy_id, is_active);

GRANT ALL ON public.pharmacy_users TO service_role;
ALTER TABLE public.pharmacy_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pharmacy_users FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.user_operation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  user_id uuid NULL REFERENCES public.pharmacy_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_operation_log_pharmacy_created_idx
  ON public.user_operation_log (pharmacy_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_operation_log_user_created_idx
  ON public.user_operation_log (user_id, created_at DESC);

GRANT ALL ON public.user_operation_log TO service_role;
ALTER TABLE public.user_operation_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_operation_log FROM anon, authenticated;
