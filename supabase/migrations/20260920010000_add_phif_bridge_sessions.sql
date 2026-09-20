-- Persist PHIF Local Bridge session references for server-side PHIF Sync.
-- Stores only bridge session identifiers and status metadata. PHIF cookies,
-- credentials, CAPTCHA values, and PHIF_BRIDGE_SECRET must remain outside DB.

CREATE TABLE public.phif_bridge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  bridge_session_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NULL,
  CONSTRAINT phif_bridge_sessions_session_not_blank CHECK (length(btrim(bridge_session_id)) > 0),
  CONSTRAINT phif_bridge_sessions_status_valid CHECK (status IN ('active','inactive','expired','failed'))
);

CREATE UNIQUE INDEX phif_bridge_sessions_bridge_session_uidx
  ON public.phif_bridge_sessions (bridge_session_id);

CREATE INDEX phif_bridge_sessions_pharmacy_active_idx
  ON public.phif_bridge_sessions (pharmacy_id, expires_at DESC, created_at DESC)
  WHERE status = 'active';

CREATE UNIQUE INDEX phif_bridge_sessions_one_active_per_pharmacy_uidx
  ON public.phif_bridge_sessions (pharmacy_id)
  WHERE status = 'active';

CREATE TRIGGER trg_phif_bridge_sessions_updated_at BEFORE UPDATE ON public.phif_bridge_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

GRANT ALL ON public.phif_bridge_sessions TO service_role;
ALTER TABLE public.phif_bridge_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phif_bridge_sessions FROM anon, authenticated;
