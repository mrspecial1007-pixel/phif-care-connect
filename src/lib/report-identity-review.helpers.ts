import { actualUnit } from "./actual-units.helpers";
import { reportSettingKey, scientificReportIdentity } from "./report-medication-evidence.helpers";

export const REPORT_REVIEW_FORMS: [string, string][] = [
  ["tablet", "أقراص — Tablet"], ["capsule", "كبسولات — Capsule"],
  ["pen", "قلم — Pen"], ["vial", "فيال — Vial"], ["ampoule", "أمبول — Ampoule"],
  ["drops", "قطرات — Drops"], ["inhaler", "بخاخ — Inhaler"], ["bottle", "عبوة — Bottle"],
  ["syrup", "شراب — Syrup"], ["suspension", "معلق — Suspension"],
  ["cream", "كريم — Cream"], ["ointment", "مرهم — Ointment"], ["gel", "جل — Gel"],
  ["tube", "أنبوب — Tube"], ["solution", "محلول — Solution"],
  ["injection", "حقن — Injection"], ["powder", "مسحوق — Powder"],
  ["sachet", "أكياس — Sachet"], ["suppository", "تحاميل — Suppository"], ["patch", "لصقات — Patch"],
];

/** Complete only the form; neither ingredient nor strength is editable here. */
export function reportReviewIdentity(identity: string, form: string) {
  try {
    const parts = JSON.parse(identity);
    if (!Array.isArray(parts) || ![3, 5].includes(parts.length)
      || (parts.length === 5 && parts[3] !== "unresolved")
      || parts.slice(0, 2).some(p => typeof p !== "string" || !p.trim())
      || !REPORT_REVIEW_FORMS.some(([value]) => value === form)) return null;
    const target = scientificReportIdentity({ active_ingredient: parts[0], strength: parts[1] }, form).key;
    return reportSettingKey(target) === target ? target : null;
  } catch { return null; }
}

export function reportReviewRequest(item: any, form: string, count: string, unit: string, itemId?: string) {
  const identity = reportReviewIdentity(item.id, form);
  const baseUnit = actualUnit(unit);
  const formUnit = actualUnit(form);
  const size = count.trim() ? Number(count) : NaN;
  if (!itemId || !identity || !baseUnit || ["box", "strip"].includes(baseUnit)
    || (formUnit && formUnit !== baseUnit) || !Number.isSafeInteger(size) || size < 1 || size > 10000) return null;
  return { identity, unitsPerBox: size, baseUnit, version: 0, reviewItemId: itemId };
}
