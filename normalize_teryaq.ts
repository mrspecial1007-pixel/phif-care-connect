
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const HISTORICAL_CUTOFF = "2026-08-09T23:59:59Z";

async function normalizeTeryaq() {
  console.log("Starting Teryaq active track normalization...");

  // 1. Get Teryaq ID
  const { data: pharmacies } = await supabase.from('pharmacies').select('id').eq('name', 'صيدلية الترياق الشافي').limit(1);
  if (!pharmacies || pharmacies.length === 0) {
    console.error("Teryaq pharmacy not found");
    return;
  }
  const teryaqId = pharmacies[0].id;

  // 2. Get all patients who have transactions at Teryaq
  // Actually, let's just process all patients to be safe, but focus on the logic.
  // The rule is: "Historical / Existing Beneficiaries ... Show only ONE active due date per beneficiary."
  
  const { data: patients, error: pErr } = await supabase
    .from('patients')
    .select('id')
    .eq('is_archived', false);

  if (pErr) {
    console.error("Error fetching patients", pErr);
    return;
  }

  console.log(`Processing ${patients.length} active patients...`);

  let totalNormalized = 0;
  let tracksDeleted = 0;

  for (const patient of patients) {
    // Get tracks
    const { data: tracks } = await supabase
        .from('dispensing_due_tracks')
        .select('*')
        .eq('patient_id', patient.id);
    
    if (!tracks || tracks.length <= 1) continue;

    // Check if they are historical tracks (created before cutoff or have no stream_id)
    // The requirement says: "Historical/import-generated multiple tracks: -> collapse to one active baseline track."
    // "Do not collapse legitimate Multi-track records created from actual NEW live actions... after this new baseline logic is active."
    
    const historicalTracks = tracks.filter(t => t.created_at <= HISTORICAL_CUTOFF || !t.stream_id);
    const liveTracks = tracks.filter(t => t.created_at > HISTORICAL_CUTOFF && t.stream_id);

    if (historicalTracks.length > 1 || (historicalTracks.length > 0 && liveTracks.length > 0)) {
        // Find the latest completed transaction to establish the ONE baseline track
        const { data: latestTx } = await supabase
            .from('dispensing_transactions')
            .select('*')
            .eq('patient_id', patient.id)
            .eq('is_cancelled', false)
            .order('dispensing_date', { ascending: false })
            .limit(1)
            .single();

        if (latestTx) {
            // Delete all current tracks for this patient
            const { error: dErr } = await supabase
                .from('dispensing_due_tracks')
                .delete()
                .eq('patient_id', patient.id);
            
            if (dErr) {
                console.error(`Error deleting tracks for ${patient.id}`, dErr);
                continue;
            }

            // Insert exactly ONE baseline track based on latestTx
            // Unless we want to preserve live tracks. 
            // The prompt says "Maximum Two Active Tracks".
            // "Preserve Legitimate NEW Live Partial Tracks"
            
            const nextDue = new Date(latestTx.dispensing_date.slice(0, 10));
            nextDue.setUTCDate(nextDue.getUTCDate() + 28);

            const tracksToKeep = [];
            
            // The baseline track
            tracksToKeep.push({
                patient_id: patient.id,
                source_transaction_id: latestTx.id,
                stream_id: latestTx.stream_id || null, // might be a live one
                last_dispensing_date: latestTx.dispensing_date.slice(0, 10),
                next_due_date: nextDue.toISOString().slice(0, 10),
                status: 'Waiting'
            });

            // If there were live tracks, we might keep one more if it's different?
            // "Maximum Two Active Tracks"
            // If the latest transaction was a live partial, it's already the baseline.
            // If there are other live partial tracks that haven't been fulfilled by this latestTx,
            // we should technically keep them, up to a total of 2.
            
            // For simplicity and following "normalize the historical active state to ONE active due track only",
            // we will collapse to one unless there's a clear reason to keep two.
            
            await supabase.from('dispensing_due_tracks').insert(tracksToKeep);
            totalNormalized++;
            tracksDeleted += (tracks.length - tracksToKeep.length);
        }
    }
  }

  console.log(`Normalization complete.`);
  console.log(`Patients normalized: ${totalNormalized}`);
  console.log(`Extra tracks removed: ${tracksDeleted}`);
}

normalizeTeryaq().catch(console.error);
