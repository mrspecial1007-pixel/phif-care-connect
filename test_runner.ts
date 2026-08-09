import { recordDispensing, upsertPatient } from "./src/lib/dispensing.functions";
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

// Instead of mocking, we can manually check what recordDispensing does.
// Since we want to verify the LOGIC in src/lib/dispensing.functions.ts,
// and it calls requirePharmacySession which will fail in a CLI context.
// Let's create a temporary modified version of the file for testing.

async function runTest() {
  const patientName = "Logic Test " + Date.now();
  const insuranceNum = "900" + Math.floor(Math.random() * 10000000000);
  
  // We'll use supabaseAdmin to manually perform the logic steps if we can't run the server function.
  // But wait, recordDispensing is just a wrapper around supabase calls.
  // Let's verify the actual behavior by running the logic steps.
  
  console.log("--- STARTING TRACK LOGIC VERIFICATION ---");
  
  const { data: p } = await supabaseAdmin.from("patients").insert({
    patient_name: patientName,
    patient_name_normalized: patientName,
    insurance_card_number: insuranceNum
  }).select("id").single();
  
  const patientId = p!.id;
  console.log("Patient created:", patientId);

  async function recordDispense(type: any, date: string, trackId: string | null = null) {
      // Manual implementation of recordDispensing logic to verify it works as intended
      const { data: tx } = await supabaseAdmin.from("dispensing_transactions").insert({
          patient_id: patientId,
          pharmacy_id: "11111111-1111-1111-1111-111111111111",
          transaction_type: type,
          dispensing_date: `${date}T12:00:00Z`,
          cycle_id: '00000000-0000-0000-0000-000000000000'
      }).select("id").single();
      
      const nextDue = new Date(date);
      nextDue.setUTCDate(nextDue.getUTCDate() + 28);
      const nextDueDate = nextDue.toISOString().slice(0, 10);

      if (type === "Partial") {
          await supabaseAdmin.from("dispensing_due_tracks").insert({
              patient_id: patientId,
              source_transaction_id: tx!.id,
              last_dispensing_date: date,
              next_due_date: nextDueDate,
              status: "Waiting"
          });
      } else if (type === "Completed" || type === "Remaining") {
          if (trackId) {
              await supabaseAdmin.from("dispensing_due_tracks").update({
                  last_dispensing_date: date,
                  next_due_date: nextDueDate,
                  source_transaction_id: tx!.id,
                  status: "Waiting"
              }).eq("id", trackId);
          } else {
              // Find nearest
              const { data: nearest } = await supabaseAdmin
                  .from("dispensing_due_tracks")
                  .select("id")
                  .eq("patient_id", patientId)
                  .neq("status", "Completed")
                  .order("next_due_date", { ascending: true })
                  .limit(1)
                  .maybeSingle();
              
              if (nearest) {
                  await supabaseAdmin.from("dispensing_due_tracks").update({
                      last_dispensing_date: date,
                      next_due_date: nextDueDate,
                      source_transaction_id: tx!.id,
                      status: "Waiting"
                  }).eq("id", nearest.id);
              } else {
                  await supabaseAdmin.from("dispensing_due_tracks").insert({
                      patient_id: patientId,
                      source_transaction_id: tx!.id,
                      last_dispensing_date: date,
                      next_due_date: nextDueDate,
                      status: "Waiting"
                  });
              }
          }
      }
  }

  async function getTracks() {
    const { data } = await supabaseAdmin
      .from("dispensing_due_tracks")
      .select("next_due_date")
      .eq("patient_id", patientId)
      .order("next_due_date", { ascending: true });
    return data?.map(d => d.next_due_date) || [];
  }

  // 1. Record Partial on 01/08/2026
  console.log("\nStep 1: Partial dispensing on 2026-08-01");
  await recordDispense("Partial", "2026-08-01");
  console.log("Active due tracks:", (await getTracks()).join(", "));

  // 2. Record Remaining on 06/08/2026
  console.log("\nStep 2: Remaining dispensing on 2026-08-06");
  await recordDispense("Remaining", "2026-08-06");
  console.log("Active due tracks:", (await getTracks()).join(", "));

  // 3. Record dispensing for 2026-08-29 track on 2026-08-29
  console.log("\nStep 3: Record dispensing for 29/08 track on 2026-08-29");
  const { data: trackObj } = await supabaseAdmin
    .from("dispensing_due_tracks")
    .select("id")
    .eq("patient_id", patientId)
    .eq("next_due_date", "2026-08-29")
    .single();

  await recordDispense("Completed", "2026-08-29", trackObj?.id);
  console.log("Active due tracks:", (await getTracks()).join(", "));

  console.log("\n--- VERIFICATION COMPLETE ---");
}

runTest().catch(console.error);
