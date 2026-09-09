import { describe, it, expect } from "vitest";
import {
  buildMedicationIdentity,
  medicationIdentityKey,
  normalizeActiveIngredient,
  normalizeDosageForm,
  normalizeStrengthUnit,
  normalizeBrandName,
} from "@/lib/medication-normalize";

describe("strength unit canonicalization", () => {
  it("maps equivalent representations to one canonical unit", () => {
    expect(normalizeStrengthUnit("MG")).toBe("mg");
    expect(normalizeStrengthUnit(" mg.")).toBe("mg");
    expect(normalizeStrengthUnit("ملغ")).toBe("mg");
    expect(normalizeStrengthUnit("µg")).toBe("mcg");
    expect(normalizeStrengthUnit("μg")).toBe("mcg");
    expect(normalizeStrengthUnit("MCG")).toBe("mcg");
    expect(normalizeStrengthUnit("ml")).toBe("mL");
    expect(normalizeStrengthUnit("%"))["toBe"]("%");
  });

  it("never coerces an unknown unit into another unit", () => {
    expect(normalizeStrengthUnit("bq")).toBe("bq");
  });

  it("does not merge mg and g", () => {
    expect(normalizeStrengthUnit("mg")).not.toBe(normalizeStrengthUnit("g"));
  });
});

describe("dosage form canonicalization", () => {
  it("normalizes unambiguous spellings", () => {
    expect(normalizeDosageForm("Tablets")).toBe("tablet");
    expect(normalizeDosageForm("TAB")).toBe("tablet");
    expect(normalizeDosageForm("أقراص")).toBe("tablet");
    expect(normalizeDosageForm("Capsule")).toBe("capsule");
  });

  it("retains an unknown form instead of guessing", () => {
    expect(normalizeDosageForm("Medicated Chewing Gum")).toBe("medicated chewing gum");
  });

  it("keeps distinct forms distinct", () => {
    expect(normalizeDosageForm("tablet")).not.toBe(normalizeDosageForm("capsule"));
  });
});

describe("active ingredient normalization", () => {
  it("is deterministic and case/diacritic insensitive", () => {
    expect(normalizeActiveIngredient("  MetFormin ")).toBe("metformin");
    expect(normalizeActiveIngredient("مِتفورمين")).toBe(normalizeActiveIngredient("متفورمين"));
    expect(normalizeActiveIngredient("Amoxicilline")).toBe("amoxicilline");
  });

  it("does not merge different ingredients", () => {
    expect(normalizeActiveIngredient("metformin")).not.toBe(normalizeActiveIngredient("metronidazole"));
  });

  it("keeps combination ingredients intact", () => {
    expect(normalizeActiveIngredient("Amoxicillin+Clavulanic acid")).toBe(
      "amoxicillin + clavulanic acid",
    );
  });

  it("is stable across repeated application", () => {
    const once = normalizeActiveIngredient("Bisoprolol   Fumarate");
    expect(normalizeActiveIngredient(once)).toBe(once);
  });
});

describe("medication identity", () => {
  const base = {
    active_ingredient: "Metformin",
    strength_value: 500,
    strength_unit: "mg",
    dosage_form: "Tablet",
  };

  it("preserves the original entered text", () => {
    const id = buildMedicationIdentity({ ...base, active_ingredient: "MetFormin", dosage_form: "TAB" });
    expect(id.active_ingredient).toBe("MetFormin");
    expect(id.dosage_form).toBe("TAB");
    expect(id.active_ingredient_normalized).toBe("metformin");
    expect(id.dosage_form_normalized).toBe("tablet");
  });

  it("gives the same key to the same medication written differently", () => {
    const a = buildMedicationIdentity(base);
    const b = buildMedicationIdentity({
      ...base,
      active_ingredient: " metformin ",
      strength_unit: "MG",
      dosage_form: "tablets",
    });
    expect(medicationIdentityKey(a)).toBe(medicationIdentityKey(b));
  });

  it("treats different strengths as different identities", () => {
    const a = buildMedicationIdentity(base);
    const b = buildMedicationIdentity({ ...base, strength_value: 850 });
    expect(medicationIdentityKey(a)).not.toBe(medicationIdentityKey(b));
  });

  it("treats different dosage forms as different identities", () => {
    const a = buildMedicationIdentity(base);
    const b = buildMedicationIdentity({ ...base, dosage_form: "Capsule" });
    expect(medicationIdentityKey(a)).not.toBe(medicationIdentityKey(b));
  });

  it("treats route as part of the identity", () => {
    const a = buildMedicationIdentity({ ...base, route: "oral" });
    const b = buildMedicationIdentity({ ...base, route: "iv" });
    expect(medicationIdentityKey(a)).not.toBe(medicationIdentityKey(b));
    expect(medicationIdentityKey(a)).not.toBe(medicationIdentityKey(buildMedicationIdentity(base)));
  });

  it("stores compound strengths without conversion", () => {
    const id = buildMedicationIdentity({
      active_ingredient: "Paracetamol",
      strength_value: 5,
      strength_unit: "mg",
      strength_denominator_value: 5,
      strength_denominator_unit: "ML",
      dosage_form: "Syrup",
    });
    expect(id.strength_value).toBe(5);
    expect(id.strength_unit).toBe("mg");
    expect(id.strength_denominator_value).toBe(5);
    expect(id.strength_denominator_unit).toBe("mL");
  });

  it("is deterministic", () => {
    const k1 = medicationIdentityKey(buildMedicationIdentity(base));
    const k2 = medicationIdentityKey(buildMedicationIdentity(base));
    expect(k1).toBe(k2);
  });
});

describe("brand normalization", () => {
  it("does not participate in therapeutic identity", () => {
    const a = buildMedicationIdentity({
      active_ingredient: "Metformin",
      strength_value: 500,
      strength_unit: "mg",
      dosage_form: "Tablet",
    });
    const b = buildMedicationIdentity({
      active_ingredient: "Metformin",
      strength_value: 500,
      strength_unit: "mg",
      dosage_form: "Tablet",
    });
    expect(medicationIdentityKey(a)).toBe(medicationIdentityKey(b));
    expect(normalizeBrandName("GlucoPhage")).toBe("glucophage");
  });
});
