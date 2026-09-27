export const TIRYAQ_PHARMACY_NAME = "صيدلية الترياق الشافي";
export const ANDALUS_PHARMACY_NAME = "صيدلية الأندلس";

async function pharmacyByName(admin: any, name: string) {
  const { data, error } = await admin
    .from("pharmacies")
    .select("id, name")
    .eq("name", name)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function isAndalusSession(admin: any, pharmacyId: string) {
  const { data, error } = await admin
    .from("pharmacies")
    .select("name")
    .eq("id", pharmacyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.name === ANDALUS_PHARMACY_NAME;
}

export async function patientHasTiryaqHistory(admin: any, patientId: string) {
  const tiryaq = await pharmacyByName(admin, TIRYAQ_PHARMACY_NAME);
  if (!tiryaq?.id) return false;
  const { count, error } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("pharmacy_id", tiryaq.id);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}

function isMissingPatientAccessTable(error: any) {
  const message = String(error?.message ?? "");
  return message.includes("patient_pharmacy_access") || error?.code === "42P01";
}

async function patientAccessTableAvailable(admin: any) {
  const { error } = await admin
    .from("patient_pharmacy_access")
    .select("id", { count: "exact", head: true })
    .limit(1);
  if (!error) return true;
  if (isMissingPatientAccessTable(error)) return false;
  throw new Error(error.message);
}

export async function ensurePatientPharmacyAccess(admin: any, pharmacyId: string, patientId: string, source = "manual") {
  const { error } = await admin.from("patient_pharmacy_access").upsert(
    {
      patient_id: patientId,
      pharmacy_id: pharmacyId,
      source,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "patient_id,pharmacy_id" },
  );
  if (error) {
    if (isMissingPatientAccessTable(error)) {
      return false;
    }
    throw new Error(error.message);
  }
  return true;
}

async function patientHasSessionAccess(admin: any, pharmacyId: string, patientId: string) {
  const { count, error } = await admin
    .from("patient_pharmacy_access")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("pharmacy_id", pharmacyId);
  if (error) {
    if (isMissingPatientAccessTable(error)) return null;
    throw new Error(error.message);
  }
  return (count ?? 0) > 0;
}

async function patientAccessPharmacyCount(admin: any, patientId: string) {
  const { data, error } = await admin
    .from("patient_pharmacy_access")
    .select("pharmacy_id")
    .eq("patient_id", patientId);
  if (error) {
    if (isMissingPatientAccessTable(error)) return null;
    throw new Error(error.message);
  }
  return new Set((data ?? []).map((row: any) => row.pharmacy_id).filter(Boolean)).size;
}

export async function authorizePatientForSessionPharmacy(admin: any, pharmacyId: string, patientId: string) {
  const isAndalus = await isAndalusSession(admin, pharmacyId);
  const hasAccess = await patientHasSessionAccess(admin, pharmacyId, patientId);
  if (hasAccess === true) {
    if (!isAndalus) return true;
    const pharmacyCount = await patientAccessPharmacyCount(admin, patientId);
    return pharmacyCount === 1;
  }
  if (hasAccess === false) {
    const hasAccessTable = await patientAccessTableAvailable(admin);
    if (hasAccessTable) return false;
  }
  if (hasAccess === null && isAndalus) return false;

  if (isAndalus && (await patientHasTiryaqHistory(admin, patientId))) {
    return false;
  }

  const { count: mine, error: mineError } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .eq("pharmacy_id", pharmacyId);
  if (mineError) throw new Error(mineError.message);
  if ((mine ?? 0) > 0) return true;

  const { count: any, error: anyError } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId);
  if (anyError) throw new Error(anyError.message);
  return (any ?? 0) === 0;
}

export async function patientAccessSetsForSession(admin: any, pharmacyId: string) {
  const served = new Set<string>();
  const anyTx = new Set<string>();
  const excluded = new Set<string>();
  const hasAccessTable = await patientAccessTableAvailable(admin);
  const isAndalus = await isAndalusSession(admin, pharmacyId);

  const PAGE = 1000;
  if (hasAccessTable) {
    const pharmacyCountByPatient = new Map<string, Set<string>>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("patient_pharmacy_access")
        .select("patient_id, pharmacy_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) {
        anyTx.add(r.patient_id);
        if (!pharmacyCountByPatient.has(r.patient_id)) pharmacyCountByPatient.set(r.patient_id, new Set());
        pharmacyCountByPatient.get(r.patient_id)!.add(r.pharmacy_id);
        if (r.pharmacy_id === pharmacyId) served.add(r.patient_id);
      }
      if (rows.length < PAGE) break;
    }
    if (isAndalus) {
      for (const [patientId, pharmacies] of pharmacyCountByPatient) {
        if (pharmacies.size > 1) {
          excluded.add(patientId);
          served.delete(patientId);
        }
      }
    }
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("patients")
        .select("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const r of rows) anyTx.add(r.id);
      if (rows.length < PAGE) break;
    }
    return { served, anyTx, excluded, accessTableEnforced: true };
  }

  if (isAndalus) return { served, anyTx, excluded, accessTableEnforced: true };

  const tiryaq = isAndalus ? await pharmacyByName(admin, TIRYAQ_PHARMACY_NAME) : null;

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("dispensing_transactions")
      .select("patient_id, pharmacy_id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const r of rows) {
      anyTx.add(r.patient_id);
      if (r.pharmacy_id === pharmacyId) served.add(r.patient_id);
      if (isAndalus && tiryaq?.id && r.pharmacy_id === tiryaq.id) excluded.add(r.patient_id);
    }
    if (rows.length < PAGE) break;
  }

  return { served, anyTx, excluded, accessTableEnforced: false };
}
