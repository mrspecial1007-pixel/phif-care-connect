import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const createDispensingSchema = z.object({
  patient_id: z.string().uuid(),
  transaction_type: z.enum(["Partial", "Remaining", "Completed"]),
  items_dispensed: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(1000).optional().nullable(),
});

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const recordDispensing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createDispensingSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const today = new Date().toISOString().slice(0, 10);

    // Load patient + latest non-completed cycle
    const { data: patient, error: pErr } = await supabaseAdmin
      .from("patients")
      .select("id, patient_name")
      .eq("id", data.patient_id)
      .maybeSingle();
    if (pErr || !patient) return { ok: false as const, error: "patient_not_found" };

    const { data: openCycles } = await supabaseAdmin
      .from("dispensing_cycles")
      .select("id, status, started_at, next_due_date")
      .eq("patient_id", data.patient_id)
      .neq("status", "Completed")
      .order("started_at", { ascending: false })
      .limit(1);
    let cycle = openCycles?.[0] ?? null;

    // If no open cycle, create one starting today
    if (!cycle) {
      const started = today;
      const { data: newCycle, error: cErr } = await supabaseAdmin
        .from("dispensing_cycles")
        .insert({
          patient_id: data.patient_id,
          status: "Waiting",
          started_at: started,
          next_due_date: addDays(started, 28),
        })
        .select("id, status, started_at, next_due_date")
        .single();
      if (cErr || !newCycle) return { ok: false as const, error: "cycle_create_failed" };
      cycle = newCycle;
    }

    // Rules:
    // - Partial: cycle -> Partial
    // - Remaining or Completed: cycle -> Completed, set completed_at=today, next_due_date=today+28
    let nextStatus: "Waiting" | "Partial" | "Completed" = cycle.status as any;
    const updates: Record<string, unknown> = {};
    if (data.transaction_type === "Partial") {
      nextStatus = "Partial";
      updates.status = "Partial";
    } else {
      nextStatus = "Completed";
      updates.status = "Completed";
      updates.completed_at = today;
      updates.next_due_date = addDays(today, 28);
    }
    const { error: uErr } = await supabaseAdmin
      .from("dispensing_cycles")
      .update(updates)
      .eq("id", cycle.id);
    if (uErr) return { ok: false as const, error: "cycle_update_failed" };

    const { data: tx, error: tErr } = await supabaseAdmin
      .from("dispensing_transactions")
      .insert({
        cycle_id: cycle.id,
        patient_id: data.patient_id,
        pharmacy_id,
        transaction_type: data.transaction_type,
        items_dispensed: data.items_dispensed ?? null,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (tErr) return { ok: false as const, error: "tx_insert_failed" };

    // If completed, open a new Waiting cycle starting when next dispensing is due
    if (nextStatus === "Completed") {
      const nextStart = addDays(today, 28);
      await supabaseAdmin.from("dispensing_cycles").insert({
        patient_id: data.patient_id,
        status: "Waiting",
        started_at: nextStart,
        next_due_date: nextStart,
      });
    }

    await writeAudit({
      pharmacy_id,
      action: "record_dispensing",
      entity: "dispensing_transaction",
      entity_id: tx.id,
      after: { patient_id: data.patient_id, transaction_type: data.transaction_type, cycle_id: cycle.id },
      ip,
    });

    return { ok: true as const, transaction_id: tx.id, cycle_id: cycle.id };
  });

const upsertPatientSchema = z.object({
  id: z.string().uuid().optional(),
  patient_name: z.string().trim().min(1).max(200),
  insurance_card_number: z.string().trim().max(60).optional().nullable(),
  national_id: z.string().trim().max(60).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  birth_date: z.string().optional().nullable(),
  gender: z.string().max(20).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const upsertPatient = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => upsertPatientSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { normalizeArabicName } = await import("@/lib/name-normalize");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const norm = normalizeArabicName(data.patient_name);
    const card = data.insurance_card_number?.trim() || null;

    // Card-based dedupe
    if (card && !data.id) {
      const { data: existing } = await supabaseAdmin
        .from("patients")
        .select("id")
        .eq("insurance_card_number", card)
        .maybeSingle();
      if (existing) return { ok: true as const, id: existing.id, matched: "card" as const };
    }

    // Name-based soft match -> needs_review
    let review_status: "ok" | "needs_review" = "ok";
    let possible_duplicate_of: string | null = null;
    if (!data.id && !card) {
      const { data: nameMatch } = await supabaseAdmin
        .from("patients")
        .select("id")
        .eq("patient_name_normalized", norm)
        .limit(1)
        .maybeSingle();
      if (nameMatch) {
        review_status = "needs_review";
        possible_duplicate_of = nameMatch.id;
      }
    }

    const payload = {
      patient_name: data.patient_name.trim(),
      patient_name_normalized: norm,
      insurance_card_number: card,
      national_id: data.national_id ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
      birth_date: data.birth_date || null,
      gender: data.gender ?? null,
      notes: data.notes ?? null,
      review_status,
      possible_duplicate_of,
    };

    if (data.id) {
      const { data: before } = await supabaseAdmin.from("patients").select("*").eq("id", data.id).maybeSingle();
      const { error } = await supabaseAdmin.from("patients").update(payload).eq("id", data.id);
      if (error) return { ok: false as const, error: error.message };
      await writeAudit({ pharmacy_id, action: "update_patient", entity: "patient", entity_id: data.id, before, after: payload, ip });
      return { ok: true as const, id: data.id, matched: "updated" as const };
    }

    const { data: inserted, error } = await supabaseAdmin.from("patients").insert(payload).select("id").single();
    if (error || !inserted) return { ok: false as const, error: error?.message ?? "insert_failed" };
    await writeAudit({ pharmacy_id, action: "create_patient", entity: "patient", entity_id: inserted.id, after: payload, ip });
    return { ok: true as const, id: inserted.id, matched: "created" as const };
  });

const importSchema = z.object({
  rows: z
    .array(
      z.object({
        patient_name: z.string().trim().min(1).max(200),
        insurance_card_number: z.string().trim().max(60).optional().nullable(),
        dispensing_dates: z.array(z.string()).default([]),
      })
    )
    .min(1)
    .max(2000),
});

export const importExcelRows = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => importSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { normalizeArabicName } = await import("@/lib/name-normalize");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;

    let created = 0;
    let matchedByCard = 0;
    let needsReview = 0;
    let txAdded = 0;

    for (const row of data.rows) {
      const card = row.insurance_card_number?.trim() || null;
      const norm = normalizeArabicName(row.patient_name);
      let patientId: string | null = null;

      if (card) {
        const { data: existing } = await supabaseAdmin
          .from("patients")
          .select("id")
          .eq("insurance_card_number", card)
          .maybeSingle();
        if (existing) {
          patientId = existing.id;
          matchedByCard++;
        }
      }

      if (!patientId) {
        let review_status: "ok" | "needs_review" = "ok";
        let possible_duplicate_of: string | null = null;
        if (!card) {
          const { data: nameMatch } = await supabaseAdmin
            .from("patients")
            .select("id")
            .eq("patient_name_normalized", norm)
            .limit(1)
            .maybeSingle();
          if (nameMatch) {
            review_status = "needs_review";
            possible_duplicate_of = nameMatch.id;
            needsReview++;
          }
        }
        const { data: ins, error } = await supabaseAdmin
          .from("patients")
          .insert({
            patient_name: row.patient_name.trim(),
            patient_name_normalized: norm,
            insurance_card_number: card,
            review_status,
            possible_duplicate_of,
          })
          .select("id")
          .single();
        if (error || !ins) continue;
        patientId = ins.id;
        created++;
      }

      // Add dispensing history as Completed cycles + transactions
      for (const dt of row.dispensing_dates) {
        const clean = dt?.slice(0, 10);
        if (!clean) continue;
        const started = new Date(clean);
        started.setUTCDate(started.getUTCDate() - 28);
        const next = new Date(clean);
        next.setUTCDate(next.getUTCDate() + 28);
        const { data: cyc } = await supabaseAdmin
          .from("dispensing_cycles")
          .insert({
            patient_id: patientId,
            status: "Completed",
            started_at: started.toISOString().slice(0, 10),
            completed_at: clean,
            next_due_date: next.toISOString().slice(0, 10),
          })
          .select("id")
          .single();
        if (!cyc) continue;
        await supabaseAdmin.from("dispensing_transactions").insert({
          cycle_id: cyc.id,
          patient_id: patientId,
          pharmacy_id,
          dispensing_date: `${clean}T12:00:00Z`,
          transaction_type: "Completed",
        });
        txAdded++;
      }
    }

    await writeAudit({
      pharmacy_id,
      action: "import_excel",
      entity: "batch",
      after: { created, matchedByCard, needsReview, txAdded, rows: data.rows.length },
      ip,
    });

    return { ok: true as const, created, matchedByCard, needsReview, txAdded };
  });