
-- Idempotency + partial dispensing details
ALTER TABLE public.dispensing_transactions
  ADD COLUMN IF NOT EXISTS items_remaining integer,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS dispensing_transactions_idempotency_key_uk
  ON public.dispensing_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Helpful indexes for activity feed and status views
CREATE INDEX IF NOT EXISTS dispensing_transactions_created_at_idx
  ON public.dispensing_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx
  ON public.audit_log (created_at DESC);
