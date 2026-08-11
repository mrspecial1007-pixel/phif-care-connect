import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function recalculateTracks(patientId: string, supabase: any) {
  // 1. Get all non-cancelled transactions for patient
  const { data: transactions } = await supabase
    .from("dispensing_transactions")
    .select("id, dispensing_date, transaction_type, created_at, stream_id")
    .eq("patient_id", patientId)
    .eq("is_cancelled", false)
    .order("dispensing_date", { ascending: true });

  if (!transactions || transactions.length === 0) {
    await supabase.from("dispensing_due_tracks").delete().eq("patient_id", patientId);
    return;
  }

  const HISTORICAL_CUTOFF = "2026-08-09T23:59:59Z";
  const BASELINE_KEY = "baseline";
  const streams = new Map<string, any>();

  for (const tx of transactions) {
    const isHistorical = tx.created_at <= HISTORICAL_CUTOFF;
    let streamKey = tx.stream_id || BASELINE_KEY;

    if (isHistorical) {
      streamKey = BASELINE_KEY;
    } else if (!tx.stream_id && (tx.transaction_type === "Partial" || tx.transaction_type === "Remaining")) {
      // If it's a live multi-track tx that somehow doesn't have a stream_id yet,
      // it effectively starts its own stream.
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

  await supabase.from("dispensing_due_tracks").delete().eq("patient_id", patientId);
  if (tracksToInsert.length > 0) {
    await supabase.from("dispensing_due_tracks").insert(tracksToInsert);
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

    // 1. Determine stream_id if we are fulfilling a track
    let stream_id: string | null = null;
    if (data.track_id) {
        const { data: track } = await supabaseAdmin
            .from("dispensing_due_tracks")
            .select("stream_id")
            .eq("id", data.track_id)
            .maybeSingle();
        if (track) stream_id = track.stream_id;
    }

    // 2. If it's a new Partial/Remaining that doesn't fulfill a track, it starts its own stream
    // We'll generate a UUID for it.
    if (!stream_id && (data.transaction_type === "Partial" || data.transaction_type === "Remaining")) {
        stream_id = crypto.randomUUID();
    }

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
        cycle_id: null,
        stream_id: stream_id,
      })
      .select("id")
      .single();
    if (tErr || !tx) return { ok: false as const, error: "tx_insert_failed" };

    // Recalculate tracks will handle updating/creating the due tracks based on this new transaction
    // and its stream_id. No need to manually insert into dispensing_due_tracks here anymore.


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

      // Add dispensing history as transactions.
      // Recalculate will collapse historical transactions into one track.
      for (const dt of row.dispensing_dates) {
        const clean = dt?.slice(0, 10);
        if (!clean) continue;
        
        const { data: tx } = await supabaseAdmin.from("dispensing_transactions").insert({
          patient_id: patientId,
          pharmacy_id,
          dispensing_date: `${clean}T12:00:00Z`,
          transaction_type: "Completed",
          cycle_id: null,
        }).select("id").single();
        
        if (tx) txAdded++;
      }
      
      // Sync tracks for this patient
      await recalculateTracks(patientId, supabaseAdmin);
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

export const setFollowUpStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({
    id: z.string().uuid(),
    suspended: z.boolean(),
    reason: z.string().max(500).optional().nullable(),
  }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { writeAudit } = await import("@/lib/audit.server");
    const { getRequestIP } = await import("@tanstack/react-start/server");

    const { pharmacy_id: sessionPharmacyId } = await requirePharmacySession();
    const ip = getRequestIP({ xForwardedFor: true }) ?? null;

    const { data: before } = await supabaseAdmin
      .from("patients")
      .select("is_follow_up_suspended, follow_up_suspension_reason")
      .eq("id", data.id)
      .single();

    const { error } = await supabaseAdmin
      .from("patients")
      .update({
        is_follow_up_suspended: data.suspended,
        follow_up_suspended_at: data.suspended ? new Date().toISOString() : null,
        follow_up_suspension_reason: data.suspended ? (data.reason || null) : null,
      })
      .eq("id", data.id);

    if (error) throw error;

    await writeAudit({
      pharmacy_id: sessionPharmacyId,
      action: data.suspended ? "suspend_follow_up" : "resume_follow_up",
      entity: "patient",
      entity_id: data.id,
      before,
      after: { is_follow_up_suspended: data.suspended, reason: data.reason },
      ip,
    });

    return { ok: true };
  });
