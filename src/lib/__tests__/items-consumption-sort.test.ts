import { describe, expect, it } from "vitest";
import { analyticsSearchSchema } from "../items-analytics.helpers";
import { selectAnalyticsRows } from "../items-analytics-export";

const items = [
  { id: "unknown", ingredient: "A", boxes: null },
  { id: "low", ingredient: "C", boxes: 2 },
  { id: "high", ingredient: "B", boxes: 30 },
  { id: "zero", ingredient: "D", boxes: 0 },
];
const ids = (sort: string) => selectAnalyticsRows({ items }, "consumption", analyticsSearchSchema.parse({ sort })).map(row => row.id);

describe("consumption report ordering", () => {
  it("ranks highest documented box consumption first, leaving unknown totals last", () => {
    expect(ids("consumption_desc")).toEqual(["high", "low", "zero", "unknown"]);
  });
  it("ranks lowest consumption first without treating unknown totals as zero", () => {
    expect(ids("consumption_asc")).toEqual(["zero", "low", "high", "unknown"]);
  });
  it("ranks most beneficiaries first, hidden counts last", () => {
    const rows = [
      { id: "hidden", ingredient: "A", beneficiaries: null },
      { id: "few", ingredient: "B", beneficiaries: 3 },
      { id: "many", ingredient: "C", beneficiaries: 30 },
    ];
    const out = selectAnalyticsRows({ items: rows }, "consumption", analyticsSearchSchema.parse({ sort: "beneficiaries_desc" })).map(r => r.id);
    expect(out).toEqual(["many", "few", "hidden"]);
  });
  it("supports scientific-name order", () => {
    expect(ids("name_asc")).toEqual(["unknown", "high", "low", "zero"]);
  });
});