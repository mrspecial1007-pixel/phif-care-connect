-- Update pharmacy PIN hashes using the existing app format:
-- s1:<salt hex>:<scrypt key hex>
-- No plaintext PINs are stored in the database.

UPDATE public.pharmacies
SET pin_hash = 's1:9318626eb1bab7304e745f537ce0d161:9e5054b862189ac9d6d2c81922cca620aed5ebdfdf1ad3858d41cdab32138be9'
WHERE name = 'صيدلية الترياق الشافي';

UPDATE public.pharmacies
SET pin_hash = 's1:a38f534243181edf239619ffa1b4c643:275570f0f2fc04e657e8d58d098397164ff3cc2164ebe25bbdeb9e622ff93a5d'
WHERE name = 'صيدلية الأندلس';
