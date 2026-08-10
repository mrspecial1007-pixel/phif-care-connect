
import { supabaseAdmin } from "./src/integrations/supabase/client.server";
// We need to import recalculateTracks but it's not exported. 
// I'll copy the logic here or I should have exported it.
// Actually, I can just write a script that does the equivalent SQL.

const HISTORICAL_CUTOFF = "2026-08-09T23:59:59Z";
const TERYAQ_ID = "11111111-1111-1111-1111-111111111111";

function addDays(iso, days) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function cleanup() {
  console.log("Starting cleanup for Teryaq...");
  
  // 1. Get all beneficiaries who have transactions in Teryaq
  const { data: patients } = await supabaseAdmin
    .from("dispensing_transactions")
    .select("patient_id")
    .eq("pharmacy_id", TERYAQ_ID)
    .eq("is_cancelled", false);
    
  const patientIds = [...new Set(patients.map(p => p.patient_id))];
  console.log(`Found ${patientIds.length} unique Teryaq beneficiaries.`);

  let totalCollapsed = 0;

  for (const patientId of patientIds) {
    const { data: transactions } = await supabaseAdmin
      .from("dispensing_transactions")
      .select("id, dispensing_date, transaction_type, created_at, stream_id")
      .eq("patient_id", patientId)
      .eq("is_cancelled", false)
      .order("dispensing_date", { ascending: true });

    if (!transactions || transactions.length === 0) continue;

    const BASELINE_KEY = "baseline";
    const streams = new Map();

    for (const tx of transactions) {
      const isHistorical = tx.created_at <= HISTORICAL_CUTOFF;
      let streamKey = tx.stream_id || BASELINE_KEY;

      if (isHistorical) {
        streamKey = BASELINE_KEY;
      } else if (!tx.stream_id && (tx.transaction_type === "Partial" || tx.transaction_type === "Remaining")) {
        streamKey = tx.id;
      }

      const current = streams.get(streamKey);
      if (!current || new Date(tx.dispensing_date) >= new Date(current.dispensing_date)) {
        streams.set(streamKey, { ...tx, streamKey });
      }
    }

    const tracksToInsert = Array.from(streams.values()).map(tx => ({
      patient_id: patientId,
      source_transaction_id: tx.id,
      stream_id: tx.streamKey === BASELINE_KEY ? null : tx.streamKey,
      last_dispensing_date: tx.dispensing_date.slice(0, 10),
      next_due_date: addDays(tx.dispensing_date.slice(0, 10), 28),
      status: "Waiting"
    }));

    // Wipe and rebuild
    await supabaseAdmin.from("dispensing_due_tracks").delete().eq("patient_id", patientId);
    if (tracksToInsert.length > 0) {
      await supabaseAdmin.from("dispensing_due_tracks").insert(tracksToInsert);
    }
    
    totalCollapsed++;
    if (totalCollapsed % 20 === 0) console.log(`Processed ${totalCollapsed}/${patientIds.length}...`);
  }

  console.log("Cleanup complete.");
}

cleanup().catch(console.error);
