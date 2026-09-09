/**
 * P1 — deterministic normalization for medication identity.
 *
 * Rules:
 *  - Normalization is deterministic and stable. No fuzzy matching, ever.
 *  - The original entered text is always preserved by the caller; these
 *    functions only produce the canonical comparison value.
 *  - Ambiguous input is returned in canonical-but-unmapped form rather than
 *    being guessed into another identity.
 */

/** Lowercase, strip Arabic diacritics/tatweel, unify letters, collapse spaces. */
export function normalizeText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input).trim().toLowerCase();
  // Arabic diacritics (harakat) + tatweel
  s = s.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  // Arabic letter unification
  s = s
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه");
  // Latin diacritics
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Safe punctuation normalization
  s = s.replace(/[_\u2010-\u2015]/g, "-").replace(/["'`´]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function normalizeActiveIngredient(input: string): string {
  // Combination ingredients keep their separator; they are NOT split.
  return normalizeText(input).replace(/\s*\+\s*/g, " + ");
}

const UNIT_CANON: Record<string, string> = {
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  "مغ": "mg",
  "ملغ": "mg",
  "ملجم": "mg",
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  "غ": "g",
  "جم": "g",
  mcg: "mcg",
  "µg": "mcg",
  "μg": "mcg",
  ug: "mcg",
  microgram: "mcg",
  micrograms: "mcg",
  ml: "mL",
  millilitre: "mL",
  milliliter: "mL",
  "مل": "mL",
  l: "L",
  litre: "L",
  liter: "L",
  iu: "IU",
  "i.u": "IU",
  unit: "IU",
  units: "IU",
  "%": "%",
  meq: "mEq",
  mmol: "mmol",
};

/**
 * Canonicalize a strength unit. Unknown units are returned normalized but
 * unchanged — never coerced into a different unit.
 */
export function normalizeStrengthUnit(input: string): string {
  const key = normalizeText(input).replace(/\.$/, "");
  return UNIT_CANON[key] ?? key;
}

const FORM_CANON: Record<string, string> = {
  tablet: "tablet",
  tablets: "tablet",
  tab: "tablet",
  tabs: "tablet",
  "قرص": "tablet",
  "اقراص": "tablet",
  capsule: "capsule",
  capsules: "capsule",
  cap: "capsule",
  caps: "capsule",
  "كبسوله": "capsule",
  "كبسولات": "capsule",
  syrup: "syrup",
  "شراب": "syrup",
  suspension: "suspension",
  "معلق": "suspension",
  injection: "injection",
  ampoule: "injection",
  ampule: "injection",
  vial: "vial",
  "حقنه": "injection",
  cream: "cream",
  "كريم": "cream",
  ointment: "ointment",
  "مرهم": "ointment",
  gel: "gel",
  drops: "drops",
  "قطره": "drops",
  "نقط": "drops",
  suppository: "suppository",
  "لبوس": "suppository",
  inhaler: "inhaler",
  spray: "spray",
  patch: "patch",
  solution: "solution",
  "محلول": "solution",
  powder: "powder",
  sachet: "sachet",
};

/**
 * Canonicalize a dosage form. Unrecognized forms keep their normalized
 * original value so they require explicit mapping rather than a guess.
 */
export function normalizeDosageForm(input: string): string {
  const key = normalizeText(input);
  return FORM_CANON[key] ?? key;
}

export type MedicationIdentityInput = {
  active_ingredient: string;
  strength_value: number;
  strength_unit: string;
  strength_denominator_value?: number | null;
  strength_denominator_unit?: string | null;
  dosage_form: string;
  route?: string | null;
};

export type NormalizedMedicationIdentity = {
  active_ingredient: string;
  active_ingredient_normalized: string;
  strength_value: number;
  strength_unit: string;
  strength_denominator_value: number | null;
  strength_denominator_unit: string | null;
  dosage_form: string;
  dosage_form_normalized: string;
  route: string | null;
};

/**
 * Builds the canonical identity row. Strength values are never converted
 * between units — clinically meaningful strengths stay as entered.
 */
export function buildMedicationIdentity(
  input: MedicationIdentityInput,
): NormalizedMedicationIdentity {
  const denomValue = input.strength_denominator_value ?? null;
  const denomUnit = input.strength_denominator_unit
    ? normalizeStrengthUnit(input.strength_denominator_unit)
    : null;
  return {
    active_ingredient: input.active_ingredient.trim(),
    active_ingredient_normalized: normalizeActiveIngredient(input.active_ingredient),
    strength_value: input.strength_value,
    strength_unit: normalizeStrengthUnit(input.strength_unit),
    strength_denominator_value: denomValue === null || denomUnit === null ? null : denomValue,
    strength_denominator_unit: denomValue === null ? null : denomUnit,
    dosage_form: input.dosage_form.trim(),
    dosage_form_normalized: normalizeDosageForm(input.dosage_form),
    route: input.route ? normalizeText(input.route) : null,
  };
}

/** Deterministic string key matching the database unique index. */
export function medicationIdentityKey(id: NormalizedMedicationIdentity): string {
  return [
    id.active_ingredient_normalized,
    id.strength_value,
    id.strength_unit,
    id.strength_denominator_value ?? -1,
    id.strength_denominator_unit ?? "",
    id.dosage_form_normalized,
    id.route ?? "",
  ].join("|");
}

export function normalizeBrandName(input: string): string {
  return normalizeText(input);
}
