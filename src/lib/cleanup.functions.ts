import { createServerFn } from "@tanstack/react-start";

export const deleteTestBeneficiaries = createServerFn({ method: "POST" })
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;

    // Identify synthetic test beneficiaries
    const patterns = [
        'Test Beneficiary%',
        'TEST%',
        'Logic Test%',
        'Multi-track Logic Test%',
        'Final Logic Test%',
        'Verification Test%'
    ];

    let totalDeleted = 0;
    const deletedIds: string[] = [];

    for (const pattern of patterns) {
        const { data: matches } = await supabaseAdmin
            .from("patients")
            .select("id, patient_name")
            .ilike("patient_name", pattern);
        
        if (matches && matches.length > 0) {
            for (const p of matches) {
                // Delete related data first (though cascading should handle it, we'll be explicit for audit)
                await supabaseAdmin.from("dispensing_transactions").delete().eq("patient_id", p.id);
                await supabaseAdmin.from("dispensing_due_tracks").delete().eq("patient_id", p.id);
                await supabaseAdmin.from("communication_logs").delete().eq("patient_id", p.id);
                // cycles if exists
                await supabaseAdmin.from("dispensing_cycles").delete().eq("patient_id", p.id);

                const { error } = await supabaseAdmin.from("patients").delete().eq("id", p.id);
                if (!error) {
                    totalDeleted++;
                    deletedIds.push(p.id);
                }
            }
        }
    }

    if (totalDeleted > 0) {
        await writeAudit({
            pharmacy_id,
            action: "delete_test_data",
            entity: "batch",
            after: { count: totalDeleted, ids: deletedIds },
            ip
        });
    }

    return { ok: true, count: totalDeleted };
  });
