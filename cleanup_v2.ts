
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const LIVE_MULTITRACK_CUTOFF = "2026-08-09T23:59:59Z";

async function runCleanup() {
  const { data: patients } = await supabase
    .from('patients')
    .select('id')
    .eq('is_archived', false);

  if (!patients) return;

  console.log(`Normalizing tracks for ${patients.length} patients...`);

  for (const p of patients) {
    const { data: txs } = await supabase
      .from('dispensing_transactions')
      .select('id, dispensing_date, created_at, stream_id')
      .eq('patient_id', p.id)
      .eq('is_cancelled', false)
      .order('dispensing_date', { ascending: true });

    if (!txs || txs.length === 0) {
      await supabase.from('dispensing_due_tracks').delete().eq('patient_id', p.id);
      continue;
    }

    let baselineTx: any = null;
    const liveStreams = new Map<string, any>();

    for (const tx of txs) {
      const isHistorical = tx.created_at <= LIVE_MULTITRACK_CUTOFF;
      if (isHistorical || !tx.stream_id) {
        if (!baselineTx || new Date(tx.dispensing_date) >= new Date(baselineTx.dispensing_date)) {
          baselineTx = tx;
        }
      } else {
        const current = liveStreams.get(tx.stream_id);
        if (!current || new Date(tx.dispensing_date) >= new Date(current.dispensing_date)) {
          liveStreams.set(tx.stream_id, tx);
        }
      }
    }

    const tracksToInsert = [];
    if (baselineTx) {
      const d = new Date(baselineTx.dispensing_date.slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 28);
      tracksToInsert.push({
        patient_id: p.id,
        source_transaction_id: baselineTx.id,
        stream_id: null,
        last_dispensing_date: baselineTx.dispensing_date.slice(0, 10),
        next_due_date: d.toISOString().slice(0, 10),
        status: 'Waiting'
      });
    }

    for (const tx of liveStreams.values()) {
      if (tracksToInsert.length >= 2) break;
      if (baselineTx && tx.id === baselineTx.id) continue;
      const d = new Date(tx.dispensing_date.slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 28);
      tracksToInsert.push({
        patient_id: p.id,
        source_transaction_id: tx.id,
        stream_id: tx.stream_id,
        last_dispensing_date: tx.dispensing_date.slice(0, 10),
        next_due_date: d.toISOString().slice(0, 10),
        status: 'Waiting'
      });
    }

    await supabase.from('dispensing_due_tracks').delete().eq('patient_id', p.id);
    if (tracksToInsert.length > 0) {
      await supabase.from('dispensing_due_tracks').insert(tracksToInsert);
    }
  }
  console.log("Normalization complete.");
}

runCleanup().catch(console.error);
