
import { recordDispensing } from "./src/lib/dispensing.functions";
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

async function runTests() {
  console.log("Starting Final Verification Tests...");

  const testBeneficiaryName = "Verification Test Beneficiary " + Date.now();
  const { data: patient, error: pErr } = await supabaseAdmin.from("patients").insert({
    patient_name: testBeneficiaryName,
    patient_name_normalized: testBeneficiaryName.toLowerCase(),
    insurance_card_number: "TEST" + Date.now().toString().slice(-9)
  }).select("id").single();

  if (pErr || !patient) {
    console.error("Failed to create test patient", pErr);
    return;
  }
  const patientId = patient.id;
  console.log("Created test patient:", patientId);

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const pharmacyId = "11111111-1111-1111-1111-111111111111";

  // Test A: Dispensing today
  console.log("Test A: Dispensing today...");
  const resA = await recordDispensing({ data: {
    patient_id: patientId,
    transaction_type: "Completed",
    dispensing_date: today,
    pharmacy_id: pharmacyId
  }});
  const { data: trackA } = await supabaseAdmin.from("dispensing_due_tracks").select("next_due_date").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(1).single();
  console.log("Test A Result - Next Due:", trackA?.next_due_date);

  // Test E: Attempt future dispensing date
  console.log("Test E: Attempt future dispensing date...");
  try {
    await recordDispensing({ data: {
      patient_id: patientId,
      transaction_type: "Completed",
      dispensing_date: tomorrow,
      pharmacy_id: pharmacyId
    }});
    console.error("Test E FAILED: Future date was accepted");
  } catch (e: any) {
    console.log("Test E PASSED: Future date rejected with error:", e.message);
  }

  // Test F: Multi-track logic
  console.log("Test F: Multi-track logic...");
  // Step 1: 01/08 -> 29/08
  const resF1 = await recordDispensing({ data: {
    patient_id: patientId,
    transaction_type: "Partial",
    dispensing_date: "2026-08-01",
    pharmacy_id: pharmacyId
  }});
  // Step 2: 06/08 -> 03/09
  const resF2 = await recordDispensing({ data: {
    patient_id: patientId,
    transaction_type: "Remaining",
    dispensing_date: "2026-08-06",
    pharmacy_id: pharmacyId
  }});

  const { data: tracksF12 } = await supabaseAdmin.from("dispensing_due_tracks").select("id, next_due_date").eq("patient_id", patientId).order("next_due_date", { ascending: true });
  console.log("Tracks after F1 & F2:", tracksF12?.map(t => t.next_due_date));

  // Step 3: Processing Track 1 (29/08) on 29/08
  const trackToFulfill = tracksF12?.find(t => t.next_due_date === "2026-08-29");
  if (trackToFulfill) {
    await recordDispensing({ data: {
      patient_id: patientId,
      transaction_type: "Completed",
      track_id: trackToFulfill.id,
      dispensing_date: "2026-08-29",
      pharmacy_id: pharmacyId
    }});
  }

  const { data: finalTracks } = await supabaseAdmin.from("dispensing_due_tracks").select("next_due_date").eq("patient_id", patientId).order("next_due_date", { ascending: true });
  console.log("Final Tracks:", finalTracks?.map(t => t.next_due_date));

  // Final Cleanup of THIS test patient
  await supabaseAdmin.from("dispensing_due_tracks").delete().eq("patient_id", patientId);
  await supabaseAdmin.from("dispensing_transactions").delete().eq("patient_id", patientId);
  await supabaseAdmin.from("patients").delete().eq("id", patientId);
  console.log("Cleaned up verification test data.");
}

runTests().catch(console.error);
