ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS login_email text;

UPDATE public.pharmacies
SET login_email = 'admin@tiryaq.com'
WHERE name = 'صيدلية الترياق الشافي';

UPDATE public.pharmacies
SET login_email = 'admin@andalus.com'
WHERE name = 'صيدلية الأندلس';

CREATE UNIQUE INDEX IF NOT EXISTS pharmacies_login_email_lower_uidx
  ON public.pharmacies (lower(login_email))
  WHERE login_email IS NOT NULL;
