
import { supabaseAdmin } from "./src/integrations/supabase/client.server";

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function recordDispensingLogic(data: any) {
    const today = new Date().toISOString().slice(0, 10);
    const effectiveDate = data.dispensing_date ?? today;
    const pharmacy_id = data.pharmacy_id ?? "11111111-1111-1111-1111-111111111111";

    if (effectiveDate > today) {
      throw new Error("لا يمكن تسجيل عملية صرف بتاريخ مستقبلي");
    }

    const { data: tx, error: tErr } = await supabaseAdmin
      .from("dispensing_transactions")
      .insert({
        patient_id: data.patient_id,
        pharmacy_id,
        transaction_type: data.transaction_type,
        dispensing_date: `${effectiveDate}T12:00:00Z`,
        cycle_id: '9041c038-6683-4aee-a961-10606587090f',
      })
      .select("id")
      .single();
    if (tErr || !tx) throw new Error("tx_insert_failed: " + JSON.stringify(tErr));

    if (data.transaction_type === "Partial") {
        await supabaseAdmin.from("dispensing_due_tracks").insert({
            patient_id: data.patient_id,
            source_transaction_id: tx.id,
            last_dispensing_date: effectiveDate,
            next_due_date: addDays(effectiveDate, 28),
            status: "Waiting"
        });
    } else if (data.transaction_type === "Completed" || data.transaction_type === "Remaining") {
        if (data.track_id) {
            await supabaseAdmin.from("dispensing_due_tracks").update({
                last_dispensing_date: effectiveDate,
                next_due_date: addDays(effectiveDate, 28),
                source_transaction_id: tx.id,
                status: "Waiting"
            }).eq("id", data.track_id);
        } else {
            await supabaseAdmin.from("dispensing_due_tracks").insert({
                patient_id: data.patient_id,
                source_transaction_id: tx.id,
                last_dispensing_date: effectiveDate,
                next_due_date: addDays(effectiveDate, 28),
                status: "Waiting"
            });
        }
    }
    return { ok: true, transaction_id: tx.id };
}

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
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const pharmacyId = "11111111-1111-1111-1111-111111111111";

  // Test A: Dispensing today
  console.log("Test A: Dispensing today...");
  await recordDispensingLogic({
    patient_id: patientId,
    transaction_type: "Completed",
    dispensing_date: today,
    pharmacy_id: pharmacyId
  });
  const { data: trackA } = await supabaseAdmin.from("dispensing_due_tracks").select("next_due_date").eq("patient_id", patientId).order("created_at", { ascending: false }).limit(1).single();
  console.log("Test A Result - Next Due:", trackA?.next_due_date);

  // Test E: Attempt future dispensing date
  console.log("Test E: Attempt future dispensing date...");
  try {
    await recordDispensingLogic({
      patient_id: patientId,
      transaction_type: "Completed",
      dispensing_date: tomorrow,
      pharmacy_id: pharmacyId
    });
    console.error("Test E FAILED: Future date was accepted");
  } catch (e: any) {
    console.log("Test E PASSED: Future date rejected with error:", e.message);
  }

  // Test F: Multi-track logic
  console.log("Test F: Multi-track logic...");
  await recordDispensingLogic({
    patient_id: patientId,
    transaction_type: "Partial",
    dispensing_date: "2026-08-01",
    pharmacy_id: pharmacyId
  });
  await recordDispensingLogic({
    patient_id: patientId,
    transaction_type: "Remaining",
    dispensing_date: "2026-08-06",
    pharmacy_id: pharmacyId
  });

  const { data: tracksF12 } = await supabaseAdmin.from("dispensing_due_tracks").select("id, next_due_date").eq("patient_id", patientId).order("next_due_date", { ascending: true });
  console.log("Tracks after F1 & F2:", tracksF12?.map(t => t.next_due_date));

  // Step 3: Processing Track 1 (29/08) on 29/08
  // Need to use 2026-08-29 as effective date, which is in the future relative to current sandbox date (2026-08-09),
  // but we want to simulate this specifically.
  // We need to bypass the validation for this test simulation or set the sandbox date.
  // Actually, for the test we can just call the logic that doesn't check the future date, 
  // or we temporarily bypass it for the simulation.
  
  const trackToFulfill = tracksF12?.find(t => t.next_due_date === "2026-08-29");
  if (trackToFulfill) {
    // Bypassing future check by manually inserting
    const effectiveDate = "2026-08-29";
    const { data: tx } = await supabaseAdmin.from("dispensing_transactions").insert({
        patient_id: patientId,
        pharmacy_id,
        transaction_type: "Completed",
        dispensing_date: `${effectiveDate}T12:00:00Z`,
        cycle_id: '9041c038-6683-4aee-a961-10606587090f',
    }).select("id").single();
    
    await supabaseAdmin.from("dispensing_due_tracks").update({
        last_dispensing_date: effectiveDate,
        next_due_date: addDays(effectiveDate, 28),
        source_transaction_id: tx.id,
        status: "Waiting"
    }).eq("id", trackToFulfill.id);
  }

  const { data: finalTracks } = await supabaseAdmin.from("dispensing_due_tracks").select("next_due_date").eq("patient_id", patientId).order("next_due_date", { ascending: true });
  console.log("Final Tracks:", finalTracks?.map(t => t.next_due_date));

  // Final Cleanup
  await supabaseAdmin.from("dispensing_due_tracks").delete().eq("patient_id", patientId);
  await supabaseAdmin.from("dispensing_transactions").delete().eq("patient_id", patientId);
  await supabaseAdmin.from("patients").delete().eq("id", patientId);
  console.log("Cleaned up verification test data.");
}

runTests().catch(console.error);
