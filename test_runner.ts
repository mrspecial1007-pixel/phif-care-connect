import { recordDispensing, upsertPatient } from "./src/lib/dispensing.functions";
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

// Mock pharmacy session
import * as pharmacySession from "./src/lib/pharmacy-session.server";
(pharmacySession as any).requirePharmacySession = async () => ({
    pharmacy_id: "77777777-7777-7777-7777-777777777777",
    pharmacy_name: "Teryaq"
});

async function runTest() {
  const patientName = "Logic Test Beneficiary " + Date.now();
  const insuranceNum = "900" + Math.floor(Math.random() * 10000000000);
  
  console.log("--- STARTING TRACK LOGIC VERIFICATION ---");
  
  // Create Patient
  const pResult = await (upsertPatient as any)({
    data: { patient_name: patientName, insurance_card_number: insuranceNum }
  });
  const patientId = pResult.id;
  console.log("Patient created:", patientId);

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
  await (recordDispensing as any)({
    data: {
      patient_id: patientId,
      transaction_type: "Partial",
      dispensing_date: "2026-08-01"
    }
  });
  const tracks1 = await getTracks();
  console.log("Active due tracks:", tracks1.join(", "));

  // 2. Record Remaining on 06/08/2026
  console.log("\nStep 2: Remaining dispensing on 2026-08-06");
  await (recordDispensing as any)({
    data: {
      patient_id: patientId,
      transaction_type: "Remaining",
      dispensing_date: "2026-08-06"
    }
  });
  const tracks2 = await getTracks();
  console.log("Active due tracks:", tracks2.join(", "));

  // 3. Record dispensing for 2026-08-29 track on 2026-08-29
  console.log("\nStep 3: Record dispensing for 29/08 track on 2026-08-29");
  const { data: trackObj } = await supabaseAdmin
    .from("dispensing_due_tracks")
    .select("id")
    .eq("patient_id", patientId)
    .eq("next_due_date", "2026-08-29")
    .single();

  if (!trackObj) {
      console.error("ERROR: Track for 2026-08-29 not found!");
  } else {
      await (recordDispensing as any)({
        data: {
          patient_id: patientId,
          transaction_type: "Completed",
          dispensing_date: "2026-08-29",
          track_id: trackObj.id
        }
      });
  }
  const tracks3 = await getTracks();
  console.log("Active due tracks:", tracks3.join(", "));

  console.log("\n--- VERIFICATION COMPLETE ---");
}

runTest().catch(err => {
    console.error(err);
    process.exit(1);
});
