/**
 * P1 — minimal server surface for the medication / prescription foundation.
 *
 * Security model (identical to P0):
 *   Browser -> server function -> requirePharmacySession()
 *           -> authorization predicate -> database (service role)
 *
 * - The five P1 tables are closed to anon/authenticated in the database.
 * - pharmacy_id is ALWAYS taken from the session, never from the client.
 * - Prescription reads/writes require SERVED_BY(session.pharmacy_id, patient_id).
 * - Unauthorized prescription lookups return not_found, never a 403.
 *
 * No dispensing, eligibility, cycle, due-track, PHIF or financial logic here.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildMedicationIdentity, normalizeBrandName } from "@/lib/medication-normalize";

async function ctx() {
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { pharmacy_id } = await requirePharmacySession();
  return { pharmacy_id, admin: supabaseAdmin as any };
}

/** SERVED_BY, plus the P0 exception for a beneficiary nobody has served yet. */
async function authorizePatient(admin: any, pharmacyId: string, patientId: string) {
  const { count: mine } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("pharmacy_id", pharmacyId);
  if ((mine ?? 0) > 0) return true;
  const { count: any } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId);
  return (any ?? 0) === 0;
}

class NotFound extends Error {
  constructor() {
    super("not_found");
  }
}

/* ---------------------------------------------------------------- medications */

const medicationInput = z.object({
  active_ingredient: z.string().min(1),
  strength_value: z.number().positive(),
  strength_unit: z.string().min(1),
  strength_denominator_value: z.number().positive().nullable().optional(),
  strength_denominator_unit: z.string().min(1).nullable().optional(),
  dosage_form: z.string().min(1),
  route: z.string().min(1).nullable().optional(),
  atc_code: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
});

/**
 * Creates a medication identity, or returns the existing one when the
 * normalized identity already exists (idempotent, never duplicates).
 */
export const createMedication = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => medicationInput.parse(d))
  .handler(async ({ data }) => {
    const { admin } = await ctx();
    const identity = buildMedicationIdentity(data);
    const row = {
      ...identity,
      atc_code: data.atc_code ?? null,
      notes: data.notes ?? null,
    };
    const { data: inserted, error } = await admin
      .from("medications")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (!error) return inserted;
    if (error.code !== "23505") throw new Error(error.message);
    // Identity already exists -> return it.
    let q = admin
      .from("medications")
      .select("*")
      .eq("active_ingredient_normalized", identity.active_ingredient_normalized)
      .eq("strength_value", identity.strength_value)
      .eq("strength_unit", identity.strength_unit)
      .eq("dosage_form_normalized", identity.dosage_form_normalized);
    q =
      identity.strength_denominator_value === null
        ? q.is("strength_denominator_value", null)
        : q.eq("strength_denominator_value", identity.strength_denominator_value);
    q =
      identity.strength_denominator_unit === null
        ? q.is("strength_denominator_unit", null)
        : q.eq("strength_denominator_unit", identity.strength_denominator_unit);
    q = identity.route === null ? q.is("route", null) : q.eq("route", identity.route);
    const { data: existing, error: e2 } = await q.maybeSingle();
    if (e2) throw new Error(e2.message);
    return existing;
  });

export const searchMedications = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ q: z.string().default(""), limit: z.number().int().min(1).max(100).default(25) }).parse(d))
  .handler(async ({ data }) => {
    const { admin } = await ctx();
    let query = admin.from("medications").select("*").order("active_ingredient_normalized").limit(data.limit);
    const term = data.q.trim();
    if (term) query = query.ilike("active_ingredient_normalized", `%${term.toLowerCase()}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* -------------------------------------------------------- commercial products */

const productInput = z.object({
  brand_name: z.string().min(1),
  manufacturer: z.string().min(1).nullable().optional(),
  supplier: z.string().min(1).nullable().optional(),
  package_size: z.number().positive().nullable().optional(),
  package_unit: z.string().min(1).nullable().optional(),
  barcode: z.string().min(1).nullable().optional(),
  phif_code: z.string().min(1).nullable().optional(),
});

export const createCommercialProduct = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => productInput.parse(d))
  .handler(async ({ data }) => {
    const { admin } = await ctx();
    const { data: row, error } = await admin
      .from("commercial_products")
      .insert({
        brand_name: data.brand_name.trim(),
        brand_name_normalized: normalizeBrandName(data.brand_name),
        manufacturer: data.manufacturer ?? null,
        supplier: data.supplier ?? null,
        package_size: data.package_size ?? null,
        package_unit: data.package_unit ?? null,
        barcode: data.barcode ?? null,
        phif_code: data.phif_code ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const searchCommercialProducts = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ q: z.string().default(""), limit: z.number().int().min(1).max(100).default(25) }).parse(d))
  .handler(async ({ data }) => {
    const { admin } = await ctx();
    let query = admin.from("commercial_products").select("*").order("brand_name_normalized").limit(data.limit);
    const term = data.q.trim();
    if (term) query = query.ilike("brand_name_normalized", `%${term.toLowerCase()}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* ------------------------------------------------------------------- mappings */

export const createProductMedicationMapping = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        product_id: z.string().uuid(),
        medication_id: z.string().uuid(),
        units_per_package: z.number().positive().nullable().optional(),
        source: z.enum(["manual", "phif", "import"]),
        confidence: z.enum(["confirmed", "proposed"]),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    const { data: row, error } = await admin
      .from("product_medication_mappings")
      .insert({
        product_id: data.product_id,
        medication_id: data.medication_id,
        units_per_package: data.units_per_package ?? null,
        source: data.source,
        confidence: data.confidence,
        created_by_pharmacy_id: pharmacy_id,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Closes an active mapping (history preserved; the row is never deleted). */
export const closeProductMedicationMapping = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { admin } = await ctx();
    const { data: row, error } = await admin
      .from("product_medication_mappings")
      .update({ effective_to: new Date().toISOString() })
      .eq("id", data.id)
      .is("effective_to", null)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new NotFound();
    return row;
  });

export const listProductMappings = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ product_id: z.string().uuid(), active_only: z.boolean().default(true) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { admin } = await ctx();
    let q = admin
      .from("product_medication_mappings")
      .select("*")
      .eq("product_id", data.product_id)
      .order("effective_from", { ascending: false });
    if (data.active_only) q = q.is("effective_to", null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/* --------------------------------------------------------------- prescriptions */

export const createPrescription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        patient_id: z.string().uuid(),
        prescription_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        valid_until: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional(),
        prescriber_name: z.string().min(1).nullable().optional(),
        source: z.enum(["paper", "phif", "manual"]),
        external_ref: z.string().min(1).nullable().optional(),
        status: z.enum(["draft", "active", "cancelled"]).default("draft"),
        notes: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.patient_id))) throw new NotFound();
    const { data: row, error } = await admin
      .from("prescriptions")
      .insert({
        pharmacy_id, // session-derived, never client-supplied
        patient_id: data.patient_id,
        prescription_date: data.prescription_date,
        valid_until: data.valid_until ?? null,
        prescriber_name: data.prescriber_name ?? null,
        source: data.source,
        external_ref: data.external_ref ?? null,
        status: data.status,
        notes: data.notes ?? null,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listPatientPrescriptions = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ patient_id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    if (!(await authorizePatient(admin, pharmacy_id, data.patient_id))) return [];
    const { data: rows, error } = await admin
      .from("prescriptions")
      .select("*")
      .eq("pharmacy_id", pharmacy_id)
      .eq("patient_id", data.patient_id)
      .order("prescription_date", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getPrescription = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    const { data: rx, error } = await admin
      .from("prescriptions")
      .select("*")
      .eq("id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rx) throw new NotFound();
    const { data: items, error: e2 } = await admin
      .from("prescription_items")
      .select("*")
      .eq("prescription_id", rx.id)
      .order("line_number");
    if (e2) throw new Error(e2.message);
    return { ...rx, items: items ?? [] };
  });

export const updatePrescriptionStatus = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["draft", "active", "cancelled"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    const { data: row, error } = await admin
      .from("prescriptions")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new NotFound();
    return row;
  });

/* ---------------------------------------------------------- prescription items */

export const addPrescriptionItem = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        prescription_id: z.string().uuid(),
        medication_id: z.string().uuid().nullable().optional(),
        raw_text: z.string().min(1),
        quantity_prescribed: z.number().positive().nullable().optional(),
        quantity_unit: z.string().min(1).nullable().optional(),
        dose_instructions: z.string().min(1).nullable().optional(),
        days_supply: z.number().int().positive().nullable().optional(),
        line_number: z.number().int().positive(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    const { data: rx, error: e0 } = await admin
      .from("prescriptions")
      .select("id")
      .eq("id", data.prescription_id)
      .eq("pharmacy_id", pharmacy_id)
      .maybeSingle();
    if (e0) throw new Error(e0.message);
    if (!rx) throw new NotFound();
    const { data: row, error } = await admin
      .from("prescription_items")
      .insert({
        prescription_id: data.prescription_id,
        pharmacy_id, // session-derived
        medication_id: data.medication_id ?? null,
        raw_text: data.raw_text,
        quantity_prescribed: data.quantity_prescribed ?? null,
        quantity_unit: data.quantity_unit ?? null,
        dose_instructions: data.dose_instructions ?? null,
        days_supply: data.days_supply ?? null,
        line_number: data.line_number,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

/** Assigns (or clears) the therapeutic identity of an existing item line. */
export const setPrescriptionItemMedication = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), medication_id: z.string().uuid().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { pharmacy_id, admin } = await ctx();
    const { data: row, error } = await admin
      .from("prescription_items")
      .update({ medication_id: data.medication_id })
      .eq("id", data.id)
      .eq("pharmacy_id", pharmacy_id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new NotFound();
    return row;
  });
