import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyPhifItemSource,
  normalizePhifCard,
  parsePhifTodayTransactions,
  parsePhifTransactionDetail,
} from "@/lib/phif-sync.functions";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("PHIF sync foundation", () => {
  it("parses /toDaysTransaction rows without calling PHIF", () => {
    const rows = parsePhifTodayTransactions({
      data: [
        {
          invoiceId: "INV-001",
          beneficiaryCode: "0000123456789",
          beneficiaryName: "مستفيد تجريبي",
          status: "confirmed",
          action: "view",
        },
      ],
    });

    expect(rows).toEqual([
      {
        invoice_key: "INV-001",
        invoice_id: "INV-001",
        beneficiary_code: "0000123456789",
        beneficiary_name: "مستفيد تجريبي",
        status: "confirmed",
        action: "view",
      },
    ]);
  });

  it("parses /getTransaction details and preserves leading zeros", () => {
    const detail = parsePhifTransactionDetail("INV-001", {
      invoiceNumber: "45",
      beneficiaryName: "مستفيد تجريبي",
      insuranceCardNumber: "0000123456789",
      dispensingDateTime: "2026-09-18 10:30:15",
      status: "confirmed",
      items: [
        {
          itemId: "DRUG-1",
          activeIngredient: "Metformin",
          concentration: "500 mg",
          commercialName: "Glucophage",
          quantity: "2",
          supplierCommercialName: "PHIF Supplier",
          phifValue: "15.5",
        },
      ],
    });

    expect(detail.insurance_card_number).toBe("0000123456789");
    expect(detail.dispensing_date).toBe("2026-09-18");
    expect(detail.dispensing_time).toBe("10:30:15");
    expect(detail.items[0]).toMatchObject({
      phif_item_id: "DRUG-1",
      active_ingredient: "Metformin",
      strength: "500 mg",
      brand: "Glucophage",
      quantity: 2,
      source_classification: "phif-supplier",
    });
    expect(detail.items[0].phif_financial_fields).toEqual({ phifValue: "15.5" });
  });

  it("does not coerce insurance card numbers to numbers", () => {
    expect(normalizePhifCard("000000123")).toBe("000000123");
    expect(normalizePhifCard(123)).toBe("123");
  });

  it("classifies source per invoice item", () => {
    expect(classifyPhifItemSource({ supplier: "phif-supplier" })).toBe("phif-supplier");
    expect(classifyPhifItemSource({ supplier: "Actual Supplier Co" })).toBe("actual-supplier");
  });

  it("defines invoice deduplication within each pharmacy only", () => {
    const migration = readProjectFile("supabase/migrations/20260918010000_add_phif_sync_tables.sql");
    expect(migration).toContain("phif_invoices_pharmacy_invoice_key_uidx");
    expect(migration).toContain("ON public.phif_invoices (pharmacy_id, invoice_key)");

    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    expect(source).toContain('.from("phif_invoices")');
    expect(source).toContain('.eq("pharmacy_id", pharmacy_id)');
    expect(source).toContain('.eq("invoice_key", invoice.invoice_key)');
  });

  it("keeps PHIF phase 1 isolated from dispensing and patient writes", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    expect(source).not.toContain('.from("dispensing_transactions").insert');
    expect(source).not.toContain('.from("dispensing_transactions").update');
    expect(source).not.toContain('.from("dispensing_transactions").delete');
    expect(source).not.toContain('.from("dispensing_due_tracks")');
    expect(source).not.toContain('.from("dispensing_cycles")');
    expect(source).not.toContain('.from("patients").insert');
    expect(source).not.toContain("recalculateTracks");
  });

  it("uses server-side bridge API without exposing the bridge secret to the browser", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    const route = readProjectFile("src/routes/phif-sync.tsx");

    expect(source).toContain("process.env.PHIF_BRIDGE_SECRET");
    expect(source).toContain("\"X-PHIF-Bridge-Secret\"");
    expect(source).toContain("/api/bridge-sessions");
    expect(source).toContain("/today-transactions");
    expect(source).toContain("/historical-transactions");
    expect(source).toContain("/invoices/");
    expect(route).not.toContain("PHIF_BRIDGE_SECRET");
    expect(route).toContain("createPhifLoginSession");
  });

  it("supports historical PHIF ranges without exposing bridge sessions", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    const route = readProjectFile("src/routes/phif-sync.tsx");

    expect(source).toContain("inspectPhifTransactionsRange");
    expect(source).toContain("dateFrom");
    expect(source).toContain("dateTo");
    expect(source).toContain("/historical-transactions");
    expect(route).toContain('type="date"');
    expect(route).toContain("inspectPhifTransactionsRange");
    expect(route).not.toContain("bridge_session_id");
  });

  it("keeps same-day PHIF checks on the proven today-transactions path", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");

    expect(source).toContain("isTodayOnly");
    expect(source).toContain("!isTodayOnly");
    expect(source).toContain("/today-transactions");
    expect(source).toContain("/historical-transactions");
  });

  it("stores PHIF bridge session references in server-only persistent storage", () => {
    const migration = readProjectFile("supabase/migrations/20260920010000_add_phif_bridge_sessions.sql");
    const source = readProjectFile("src/lib/phif-sync.functions.ts");

    expect(migration).toContain("CREATE TABLE public.phif_bridge_sessions");
    expect(migration).toContain("pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id)");
    expect(migration).toContain("bridge_session_id text NOT NULL");
    expect(migration).toContain("ALTER TABLE public.phif_bridge_sessions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.phif_bridge_sessions FROM anon, authenticated");
    expect(migration).toContain("GRANT ALL ON public.phif_bridge_sessions TO service_role");

    expect(source).toContain('.from("phif_bridge_sessions")');
    expect(source).toContain('.eq("pharmacy_id", pharmacyId)');
    expect(source).toContain('.eq("status", "active")');
    expect(source).not.toContain("__phifBridgeSessions");
    expect(source).not.toContain("globalThis");
  });

  it("does not expose bridge_session_id in PHIF Sync client-facing responses", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    const route = readProjectFile("src/routes/phif-sync.tsx");
    const statusType = source.match(/type PhifSessionStatusResult = \{[\s\S]*?\};/)?.[0] ?? "";
    const createLoginResponse = source.match(/export const createPhifLoginSession[\s\S]*?return \{[\s\S]*?\};\s*\}\);/)?.[0] ?? "";

    expect(statusType).not.toContain("bridge_session_id");
    expect(createLoginResponse).not.toContain("bridge_session_id");
    expect(route).not.toContain("bridge_session_id");
  });

  it("marks missing or expired PHIF bridge sessions inactive for reuse safety", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");

    expect(source).toContain('message.includes("not found") || message.includes("expired")');
    expect(source).toContain('await markBridgeSession(db, pharmacy_id, session.bridge_session_id, "expired")');
  });
});
