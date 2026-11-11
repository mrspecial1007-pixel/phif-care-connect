import { describe, expect, it } from "vitest";
import { summaryScope } from "../items-analytics-export";

const item = (id: string, ingredient: string, extra: Record<string, unknown> = {}) => ({
  id,
  ingredient,
  strength: "75MG",
  form: "tablet",
  ...extra,
});

describe("consumption report summary scope", () => {
  it("names the single item whose movements feed the summary", () => {
    const report = {
      items: [item("a", "ACETYLSALICYLIC ACID"), item("b", "PARACETAMOL")],
      reviewItems: [],
      movements: [
        { identity: "a" },
        { identity: "a" },
      ],
    };
    expect(summaryScope(report)).toEqual({ item: report.items[0], count: 1 });
  });

  it("counts every item feeding the summary, including review items", () => {
    const report = {
      items: [item("a", "ACETYLSALICYLIC ACID")],
      reviewItems: [item("r", "UNKNOWN ITEM", { identityComplete: false })],
      movements: [{ identity: "a" }, { identity: "r" }, { identity: "a" }],
    };
    expect(summaryScope(report)).toEqual({ item: null, count: 2 });
  });

  it("reports no item when the period has no movements", () => {
    expect(summaryScope({ items: [item("a", "A")], reviewItems: [], movements: [] })).toEqual({
      item: null,
      count: 0,
    });
  });

  it("never invents a name for a movement without a matching item", () => {
    const report = {
      items: [],
      reviewItems: [],
      movements: [{ identity: "missing" }],
    };
    expect(summaryScope(report)).toEqual({ item: null, count: 1 });
  });
});
