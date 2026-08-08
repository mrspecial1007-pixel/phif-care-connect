ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS phone TEXT;

UPDATE public.pharmacies 
SET address = 'حي 7 أكتوبر – الطريق المزدوج – تحت الكوبري'
WHERE name = 'صيدلية الترياق الشافي';

UPDATE public.pharmacies 
SET address = 'شارع إسطنبول – بعد مصحة الدوحة'
WHERE name = 'صيدلية الأندلس';
