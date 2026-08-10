import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function recalculateTracks(patientId: string, supabase: any) {
  // 1. Get all non-cancelled transactions for patient
  const { data: transactions } = await supabase
    .from("dispensing_transactions")
    .select("id, dispensing_date, transaction_type")
    .eq("patient_id", patientId)
    .eq("is_cancelled", false)
    .order("dispensing_date", { ascending: true });

  // 2. Clear current tracks
  await supabase.from("dispensing_due_tracks").delete().eq("patient_id", patientId);

  if (!transactions) return;

  // 3. Simple chronological track builder (re-using logic from prompt)
  // For each transaction, if it fits an existing track (within some window), renew it.
  // Otherwise, start a new one.
  const tracks: { lastDate: string; nextDue: string; sourceId: string }[] = [];

  for (const tx of transactions) {
    const txDate = tx.dispensing_date.slice(0, 10);
    // Find a track that is "waiting" for renewal near this date (within 14 days of its next_due)
    let matchedIdx = -1;
    for (let i = 0; i < tracks.length; i++) {
        const diff = Math.abs((new Date(txDate).getTime() - new Date(tracks[i].nextDue).getTime()) / (1000 * 60 * 60 * 24));
        if (diff <= 14) {
            matchedIdx = i;
            break;
        }
    }

    const nextDue = addDays(txDate, 28);
    if (matchedIdx !== -1) {
        tracks[matchedIdx] = { lastDate: txDate, nextDue, sourceId: tx.id };
    } else {
        tracks.push({ lastDate: txDate, nextDue, sourceId: tx.id });
    }
  }

  // 4. Insert resulting tracks
  if (tracks.length > 0) {
      await supabase.from("dispensing_due_tracks").insert(
          tracks.map(t => ({
              patient_id: patientId,
              source_transaction_id: t.sourceId,
              last_dispensing_date: t.lastDate,
              next_due_date: t.nextDue,
              status: "Waiting"
          }))
      );
  }
}


function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const createDispensingSchema = z.object({
  patient_id: z.string().uuid(),
  transaction_type: z.enum(["Partial", "Remaining", "Completed"]),
  items_dispensed: z.number().int().nonnegative().nullable().optional(),
  items_remaining: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(1000).optional().nullable(),
  pharmacy_id: z.string().uuid().optional().nullable(),
  dispensing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  idempotency_key: z.string().min(8).max(80).optional().nullable(),
  historical_mode: z.enum(["append", "recalc"]).optional().nullable(),
  track_id: z.string().uuid().optional().nullable(), // The track being fulfilled
});

export const recordDispensing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createDispensingSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const today = new Date().toISOString().slice(0, 10);
    const effectiveDate = data.dispensing_date ?? today;
    const pharmacy_id = data.pharmacy_id ?? sessionPharmacyId;

    if (effectiveDate > today) {
      throw new Error("لا يمكن تسجيل عملية صرف بتاريخ مستقبلي");
    }

    // Idempotency check
    if (data.idempotency_key) {
      const { data: existingTx } = await supabaseAdmin
        .from("dispensing_transactions")
        .select("id")
        .eq("idempotency_key", data.idempotency_key)
        .maybeSingle();
      if (existingTx) {
        return { ok: true as const, transaction_id: existingTx.id, deduped: true };
      }
    }

    // Load patient
    const { data: patient } = await supabaseAdmin
      .from("patients")
      .select("id")
      .eq("id", data.patient_id)
      .maybeSingle();
    if (!patient) return { ok: false as const, error: "patient_not_found" };

    // Record the transaction
    const { data: tx, error: tErr } = await supabaseAdmin
      .from("dispensing_transactions")
      .insert({
        patient_id: data.patient_id,
        pharmacy_id,
        transaction_type: data.transaction_type,
        items_dispensed: data.items_dispensed ?? null,
        notes: data.notes ?? null,
        dispensing_date: `${effectiveDate}T12:00:00Z`,
        idempotency_key: data.idempotency_key ?? null,
        cycle_id: '00000000-0000-0000-0000-000000000000', // Dummy for legacy FK if exists
      })
      .select("id")
      .single();
    if (tErr || !tx) return { ok: false as const, error: "tx_insert_failed" };

    // Update or Create Track
    // 1. If we have a track_id, it means we are fulfilling an existing requirement.
    // 2. If it's Partial, we start a NEW track for the dispensed items.
    // 3. If it's Completed, we either update the chosen track OR create a new one if none was chosen.

    if (data.transaction_type === "Partial") {
        // Partial: This creates a new track starting today.
        // It does NOT fulfill an existing track (or maybe it fulfills one and leaves others?)
        // The rule says: "Every dispensing creates a track".
        await supabaseAdmin.from("dispensing_due_tracks").insert({
            patient_id: data.patient_id,
            source_transaction_id: tx.id,
            last_dispensing_date: effectiveDate,
            next_due_date: addDays(effectiveDate, 28),
            status: "Waiting"
        });
    } else if (data.transaction_type === "Completed" || data.transaction_type === "Remaining") {
        if (data.track_id) {
            // Fulfilling a specific track
            await supabaseAdmin.from("dispensing_due_tracks").update({
                last_dispensing_date: effectiveDate,
                next_due_date: addDays(effectiveDate, 28),
                source_transaction_id: tx.id,
                status: "Waiting"
            }).eq("id", data.track_id);
        } else {
            // ALWAYS start a new track for a new dispensing batch, 
            // unless a specific track was explicitly selected to be fulfilled.
            await supabaseAdmin.from("dispensing_due_tracks").insert({
                patient_id: data.patient_id,
                source_transaction_id: tx.id,
                last_dispensing_date: effectiveDate,
                next_due_date: addDays(effectiveDate, 28),
                status: "Waiting"
            });
        }
    }

    await writeAudit({
      pharmacy_id,
      action: "record_dispensing",
      entity: "dispensing_transaction",
      entity_id: tx.id,
      after: { patient_id: data.patient_id, transaction_type: data.transaction_type, effective_date: effectiveDate },
      ip,
    });

    // CRITICAL: Always recalculate tracks after ANY dispensing to ensure multi-track consistency
    await recalculateTracks(data.patient_id, supabaseAdmin);

    return { ok: true as const, transaction_id: tx.id };
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
  is_favorite: z.boolean().optional(),
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

    if (card && !data.id) {
      const { data: existing } = await supabaseAdmin
        .from("patients")
        .select("id")
        .eq("insurance_card_number", card)
        .maybeSingle();
      if (existing) return { ok: true as const, id: existing.id, matched: "card" as const };
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
      is_favorite: data.is_favorite ?? false,
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
        const { data: ins, error } = await supabaseAdmin
          .from("patients")
          .insert({
            patient_name: row.patient_name.trim(),
            patient_name_normalized: norm,
            insurance_card_number: card,
          })
          .select("id")
          .single();
        if (error || !ins) continue;
        patientId = ins.id;
        created++;
      }

      // Add dispensing history as transactions and tracks
      // For each date, create a transaction and a track.
      // If dates are within 28 days, they result in separate tracks.
      for (const dt of row.dispensing_dates) {
        const clean = dt?.slice(0, 10);
        if (!clean) continue;
        
        const { data: tx } = await supabaseAdmin.from("dispensing_transactions").insert({
          patient_id: patientId,
          pharmacy_id,
          dispensing_date: `${clean}T12:00:00Z`,
          transaction_type: "Completed",
          cycle_id: '00000000-0000-0000-0000-000000000000',
        }).select("id").single();
        
        if (tx) {
            await supabaseAdmin.from("dispensing_due_tracks").insert({
                patient_id: patientId,
                source_transaction_id: tx.id,
                last_dispensing_date: clean,
                next_due_date: addDays(clean, 28),
                status: "Waiting"
            });
            txAdded++;
        }
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
export const updateDispensing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    dispensing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    pharmacy_id: z.string().uuid(),
    transaction_type: z.enum(["Partial", "Remaining", "Completed"]),
    notes: z.string().max(1000).optional().nullable(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;
    const today = new Date().toISOString().slice(0, 10);

    if (data.dispensing_date > today) {
      throw new Error("لا يمكن تسجيل عملية صرف بتاريخ مستقبلي");
    }

    const { data: before } = await supabaseAdmin
      .from("dispensing_transactions")
      .select("*")
      .eq("id", data.id)
      .single();
    
    if (!before) throw new Error("Transaction not found");

    const { error } = await supabaseAdmin
      .from("dispensing_transactions")
      .update({
        dispensing_date: `${data.dispensing_date}T12:00:00Z`,
        pharmacy_id: data.pharmacy_id,
        transaction_type: data.transaction_type,
        notes: data.notes,
      })
      .eq("id", data.id);

    if (error) throw error;

    // Recalculate tracks for this patient
    await recalculateTracks(before.patient_id, supabaseAdmin);

    await writeAudit({
      pharmacy_id: sessionPharmacyId,
      action: "update_dispensing",
      entity: "dispensing_transaction",
      entity_id: data.id,
      before,
      after: data,
      ip,
    });

    return { ok: true };
  });

export const cancelDispensing = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    reason: z.string().min(1).max(500),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;

    const { data: tx } = await supabaseAdmin
      .from("dispensing_transactions")
      .select("patient_id")
      .eq("id", data.id)
      .single();
    
    if (!tx) throw new Error("Transaction not found");

    const { error } = await supabaseAdmin
      .from("dispensing_transactions")
      .update({
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        cancelled_by: sessionPharmacyId,
        cancellation_reason: data.reason,
      })
      .eq("id", data.id);

    if (error) throw error;

    // Recalculate tracks for this patient
    await recalculateTracks(tx.patient_id, supabaseAdmin);

    await writeAudit({
      pharmacy_id: sessionPharmacyId,
      action: "cancel_dispensing",
      entity: "dispensing_transaction",
      entity_id: data.id,
      after: { reason: data.reason },
      ip,
    });

    return { ok: true };
  });

export const archivePatient = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;

    const { error } = await supabaseAdmin
      .from("patients")
      .update({
        is_archived: true,
        archived_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (error) throw error;

    await writeAudit({
      pharmacy_id: sessionPharmacyId,
      action: "archive_patient",
      entity: "patient",
      entity_id: data.id,
      ip,
    });

    return { ok: true };
  });
