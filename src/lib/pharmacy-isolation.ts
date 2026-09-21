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

export async function authorizePatientForSessionPharmacy(admin: any, pharmacyId: string, patientId: string) {
  if ((await isAndalusSession(admin, pharmacyId)) && (await patientHasTiryaqHistory(admin, patientId))) {
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
  const isAndalus = await isAndalusSession(admin, pharmacyId);
  const tiryaq = isAndalus ? await pharmacyByName(admin, TIRYAQ_PHARMACY_NAME) : null;

  const PAGE = 1000;
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

  return { served, anyTx, excluded };
}
