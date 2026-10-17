import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadPhifStatusItems, pickDisplayDueTrack } from "@/lib/reads.functions";

function database(rows: any[], cap = 1000, failAt?: number, emptyAt?: number) {
  const calls: number[] = [];
  return { calls, from(table: string) {
    expect(table).toBe("phif_invoice_items");
    let filtered = rows;
    const query = {
      select() { return query; },
      in(field: string, ids: string[]) { filtered = rows.filter((row) => ids.includes(row[field])); return query; },
      order(field: string) { expect(field).toBe("id"); filtered = [...filtered].sort((a, b) => a.id.localeCompare(b.id)); return query; },
      async range(from: number, to: number) {
        calls.push(from);
        if (failAt !== undefined && from >= failAt) return { data: null, error: { message: "read failed" } };
        return { data: emptyAt !== undefined && from >= emptyAt ? [] : filtered.slice(from, from + Math.min(cap, to - from + 1)), count: filtered.length, error: null };
      },
    };
    return query;
  } };
}

describe("PHIF active beneficiary status", () => {
  it("does not hide a future due track behind a three-day overdue track", () => {
    const tracks = [{ remaining_days: -3 }, { remaining_days: 0 }, { remaining_days: 8 }];
    expect(pickDisplayDueTrack(tracks)).toBe(tracks[1]);
    expect(pickDisplayDueTrack([{ remaining_days: -2 }, ...tracks])).toEqual({ remaining_days: -2 });
    expect(pickDisplayDueTrack([{ remaining_days: -10 }])).toEqual({ remaining_days: -10 });
    expect(pickDisplayDueTrack([])).toBeNull();
  });

  it("reads all items, including beneficiaries beyond the API row limit", async () => {
    const rows = Array.from({ length: 1005 }, (_, i) => ({ id: String(i).padStart(5, "0"), phif_invoice_id: "authorized-invoice" }));
    const db = database([...rows, { id: "other", phif_invoice_id: "other-pharmacy-invoice" }]);
    expect(await loadPhifStatusItems(db, ["authorized-invoice"])).toEqual(rows);
    expect(db.calls).toEqual([0, 1000]);
  });

  it("supports lower API caps and does not skip items", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ id: String(i), phif_invoice_id: "a" }));
    expect(await loadPhifStatusItems(database(rows, 2), ["a"])).toEqual(rows);
    expect(await loadPhifStatusItems(database(rows), [])).toEqual([]);
  });

  it("fails visibly instead of returning incomplete due information", async () => {
    const rows = [{ id: "1", phif_invoice_id: "a" }, { id: "2", phif_invoice_id: "a" }];
    await expect(loadPhifStatusItems(database(rows, 1, 1), ["a"])).rejects.toThrow("read failed");
    await expect(loadPhifStatusItems(database(rows, 1, undefined, 1), ["a"])).rejects.toThrow("Incomplete PHIF item read");
  });

  it("refreshes on return and periodically without requiring a page reload", () => {
    const source = readFileSync("src/lib/queries.ts", "utf8");
    expect(source).toContain("refetchInterval: 60_000");
    expect(source).toContain('refetchOnWindowFocus: "always"');
    expect(source).toContain("daysUntilDate(summary.next_due_date)");
    const dashboard = readFileSync("src/routes/index.tsx", "utf8");
    expect(dashboard).not.toContain("sorted.slice(0, 500)");
  });

  it("clears manual cycle state only after the Tiryaq session guard", () => {
    const source = readFileSync("src/lib/reads.functions.ts", "utf8");
    const section = source.slice(source.indexOf("export const listPatientStatuses"), source.indexOf("export const getPatient ="));
    expect(section.indexOf("if (pharmacy_name !== TIRYAQ_PHARMACY_NAME) return filtered")).toBeLessThan(section.indexOf("...resetManualOperationalStatus(row)"));
    expect(section).not.toContain("...row,");
    expect(section).not.toMatch(/\.delete\(|\.update\(|\.insert\(/);
  });
});
