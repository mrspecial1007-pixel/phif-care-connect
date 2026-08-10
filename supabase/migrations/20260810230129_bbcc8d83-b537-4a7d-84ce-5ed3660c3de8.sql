ALTER TABLE public.dispensing_transactions ADD COLUMN fulfilled_track_id uuid REFERENCES public.dispensing_due_tracks(id) ON DELETE SET NULL;

-- Refresh the view
DROP VIEW IF EXISTS v_patient_status;
CREATE OR REPLACE VIEW public.v_patient_status AS
 SELECT p.id,
    p.patient_name,
    p.patient_name_normalized,
    p.insurance_card_number,
    p.national_id,
    p.phone,
    p.address,
    p.birth_date,
    p.gender,
    p.notes,
    p.is_favorite,
    p.is_archived,
    p.is_follow_up_suspended,
    p.follow_up_suspended_at,
    p.follow_up_suspension_reason,
    COALESCE(( 
        SELECT jsonb_agg(track_data) FROM (
            SELECT jsonb_build_object(
                'id', t.id, 
                'last_dispensing_date', t.last_dispensing_date, 
                'next_due_date', t.next_due_date, 
                'remaining_days', (t.next_due_date - CURRENT_DATE), 
                'status', t.status
            ) as track_data
            FROM public.dispensing_due_tracks t
            WHERE t.patient_id = p.id AND t.status = 'Waiting'::cycle_status
            ORDER BY t.next_due_date
        ) s
    ), '[]'::jsonb) AS tracks,
    ( SELECT t.next_due_date
           FROM public.dispensing_due_tracks t
          WHERE t.patient_id = p.id AND t.status = 'Waiting'::cycle_status
          ORDER BY t.next_due_date
         LIMIT 1) AS next_due_date,
    ( SELECT ph.name
           FROM public.dispensing_transactions tx
             JOIN public.pharmacies ph ON tx.pharmacy_id = ph.id
          WHERE tx.patient_id = p.id AND tx.is_cancelled = false
          ORDER BY tx.dispensing_date DESC, tx.created_at DESC
         LIMIT 1) AS last_pharmacy_name
   FROM public.patients p
  WHERE p.is_archived = false;

GRANT SELECT ON public.v_patient_status TO authenticated;
ALTER VIEW public.v_patient_status SET (security_invoker = on);
