DO $$
DECLARE
    p_record RECORD;
    t_record RECORD;
    tx_date DATE;
    next_due_date DATE;
    matched_id UUID;
BEGIN
    CREATE TEMP TABLE temp_tracks (
        patient_id UUID,
        last_date DATE,
        next_due DATE,
        source_id UUID
    ) ON COMMIT DROP;

    FOR p_record IN SELECT id FROM patients WHERE is_archived = false LOOP
        DELETE FROM dispensing_due_tracks WHERE patient_id = p_record.id;
        DELETE FROM temp_tracks;

        FOR t_record IN 
            SELECT id, dispensing_date::date as d_date 
            FROM dispensing_transactions 
            WHERE patient_id = p_record.id AND is_cancelled = false 
            ORDER BY dispensing_date ASC 
        LOOP
            tx_date := t_record.d_date;
            matched_id := NULL;

            SELECT source_id INTO matched_id
            FROM temp_tracks
            WHERE ABS(tx_date - next_due) <= 14
            LIMIT 1;

            next_due_date := tx_date + INTERVAL '28 days';

            IF matched_id IS NOT NULL THEN
                UPDATE temp_tracks 
                SET last_date = tx_date, next_due = next_due_date, source_id = t_record.id
                WHERE source_id = matched_id;
            ELSE
                INSERT INTO temp_tracks (patient_id, last_date, next_due, source_id)
                VALUES (p_record.id, tx_date, next_due_date, t_record.id);
            END IF;
        END LOOP;

        INSERT INTO dispensing_due_tracks (patient_id, source_transaction_id, last_dispensing_date, next_due_date, status)
        SELECT patient_id, source_id, last_date, next_due, 'Waiting'
        FROM temp_tracks;
    END LOOP;
END $$;