import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function runTest() {
  const patientName = "Multi-track Logic Test FIXED " + Date.now();
  const insuranceNum = "900" + Math.floor(Math.random() * 10000000000);
  
  console.log("--- STARTING TRACK LOGIC VERIFICATION ---");
  
  const { data: p } = await supabaseAdmin.from("patients").insert({
    patient_name: patientName,
    patient_name_normalized: patientName,
    insurance_card_number: insuranceNum
  }).select("id").single();
  
  const patientId = p!.id;
  console.log("Patient created:", patientId);

  const { data: cycle } = await supabaseAdmin.from("dispensing_cycles").insert({
    patient_id: patientId,
    started_at: new Date().toISOString().slice(0, 10),
    status: "Waiting"
  }).select("id").single();
  
  const cycleId = cycle!.id;

  async function recordDispense(type: string, date: string, trackId: string | null = null) {
      const { data: tx } = await supabaseAdmin.from("dispensing_transactions").insert({
          patient_id: patientId,
          pharmacy_id: "11111111-1111-1111-1111-111111111111",
          transaction_type: type,
          dispensing_date: `${date}T12:00:00Z`,
          cycle_id: cycleId
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
              // FIXED LOGIC: Insert new track instead of updating nearest
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
  const { data: tracks } = await supabaseAdmin
    .from("dispensing_due_tracks")
    .select("id, next_due_date")
    .eq("patient_id", patientId)
    .eq("next_due_date", "2026-08-29");
  
  const targetTrack = tracks?.[0]?.id;
  await recordDispense("Completed", "2026-08-29", targetTrack);
  console.log("Active due tracks:", (await getTracks()).join(", "));

  console.log("\n--- VERIFICATION COMPLETE ---");
}

runTest().catch(console.error);
