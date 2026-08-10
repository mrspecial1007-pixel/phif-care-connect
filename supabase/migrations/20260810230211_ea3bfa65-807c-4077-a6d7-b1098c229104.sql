ALTER TABLE public.dispensing_transactions RENAME COLUMN fulfilled_track_id TO stream_id;
ALTER TABLE public.dispensing_due_tracks ADD COLUMN stream_id uuid;

-- Update existing tracks to have stream_id = source_transaction_id as a starting point
UPDATE public.dispensing_due_tracks SET stream_id = source_transaction_id WHERE stream_id IS NULL;
