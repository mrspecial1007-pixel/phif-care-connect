import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyPhifItemSource,
  completeSavedPhifInvoiceItemsFromSource,
  filterMissingPhifInvoiceItems,
  normalizePhifCard,
  parsePhifTodayTransactions,
  parsePhifTransactionDetail,
  phifInvoiceItemDedupeKey,
} from "@/lib/phif-sync.functions";
import {
  buildPhifDueSummaries,
  buildPhifMedicationProfileFromRows,
  phifMedicationIdentityKey,
} from "@/lib/phif-invoices.functions";
import { buildPhifHistoryRows, phifDueSummariesToTracks } from "@/lib/reads.functions";
import { normalizePhifStockRows } from "@/lib/phif-stock.functions";
import {
  calculateActualGrossMargin,
  matchActualInvoiceItemToStock,
  stockSnapshotCandidatesForInvoice,
  stockQuantityBreakdown,
} from "@/lib/phif-stock.helpers";

function readProjectFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function phifItem(
  phif_item_id: string,
  active_ingredient: string,
  strength: string,
  supplier = "PHIF Supplier",
  source_classification = "phif-supplier",
) {
  return {
    phif_item_id,
    active_ingredient,
    strength,
    brand: null,
    quantity: 30,
    supplier,
    source_classification,
    phif_financial_fields: {},
    metadata: {},
  };
}

function fakePhifItemsDb(initialRows: Record<string, any[]>) {
  const rowsByInvoice = new Map(Object.entries(initialRows).map(([key, value]) => [key, [...value]]));
  const inserted: any[] = [];
  return {
    inserted,
    from(table: string) {
      if (table !== "phif_invoice_items") throw new Error(`Unexpected table ${table}`);
      return {
        select() {
          return {
            async eq(column: string, invoiceId: string) {
              if (column !== "phif_invoice_id") throw new Error(`Unexpected filter ${column}`);
              return { data: rowsByInvoice.get(invoiceId) ?? [], error: null };
            },
          };
        },
        async insert(rows: any[]) {
          inserted.push(...rows);
          for (const row of rows) {
            const current = rowsByInvoice.get(row.phif_invoice_id) ?? [];
            current.push(row);
            rowsByInvoice.set(row.phif_invoice_id, current);
          }
          return { error: null };
        },
      };
    },
  };
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

  it("backfills item rows for a saved PHIF invoice that has no items", () => {
    const incoming = [
      {
        phif_item_id: "DRUG-1",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Glucophage",
        quantity: 2,
        supplier: "PHIF Supplier",
        source_classification: "phif-supplier",
        phif_financial_fields: { phifValue: "15.5" },
        metadata: { raw: true },
      },
    ];

    expect(filterMissingPhifInvoiceItems(incoming, [])).toEqual(incoming);
  });

  it("does not duplicate existing PHIF invoice item rows during resync", () => {
    const incoming = [
      {
        phif_item_id: "DRUG-1",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Glucophage",
        quantity: 2,
        supplier: "PHIF Supplier",
        source_classification: "phif-supplier",
        phif_financial_fields: { phifValue: "15.5" },
        metadata: {},
      },
      {
        phif_item_id: "DRUG-2",
        active_ingredient: "Amlodipine",
        strength: "5 mg",
        brand: "Norvasc",
        quantity: 1,
        supplier: "Actual Supplier Co",
        source_classification: "actual-supplier",
        phif_financial_fields: {},
        metadata: {},
      },
    ];

    const missing = filterMissingPhifInvoiceItems(incoming, [incoming[0]]);

    expect(phifInvoiceItemDedupeKey(incoming[0])).toBe(phifInvoiceItemDedupeKey({ ...incoming[0] }));
    expect(missing).toEqual([incoming[1]]);
  });

  it("reports PHIF invoice item completion counts during inspect and save", () => {
    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    const route = readProjectFile("src/routes/phif-sync.tsx");

    expect(source).toContain("completed_item_invoice_count");
    expect(source).toContain("completion_failed_count");
    expect(source).toContain("if (missing.length === 0) continue");
    expect(route).toContain("completed_item_invoice_count");
    expect(route).toContain("completion_failed_count");
    expect(route).toContain("inspectSavedPhifInvoiceItemCompletion");
    expect(route).toContain("completeSavedPhifInvoiceItemRange");
    expect(route).toContain("معاينة فقط");
    expect(route).toContain("تأكيد الحفظ");
  });

  it("dry-runs saved invoice item completion without inserting rows", async () => {
    const db = fakePhifItemsDb({ "invoice-4193942": [] });
    const result = await completeSavedPhifInvoiceItemsFromSource({
      db,
      dryRun: true,
      invoices: [
        {
          id: "invoice-4193942",
          invoice_key: "2026-4193942-real-key",
          invoice_number: "4193942",
          dispensing_date: "2026-09-15",
        },
      ],
      fetchInvoice: async () => ({
        invoice_key: "2026-4193942-real-key",
        invoice_number: "4193942",
        insurance_card_number: "0061600113888",
        beneficiary_name: "Test",
        dispensing_date: "2026-09-15",
        dispensing_time: null,
        status: "confirmed",
        metadata: {},
        items: [
          phifItem("PHIF-A", "Amlodipine", "5MG"),
          phifItem("PHIF-B", "Valsartan", "160MG"),
        ],
      }),
    });

    expect(result).toMatchObject({
      checked_count: 1,
      completed_invoice_count: 1,
      added_item_count: 2,
      dry_run: true,
    });
    expect(result.invoices[0]).toMatchObject({
      id: "invoice-4193942",
      source_item_count: 2,
      missing_item_count: 2,
      added_item_count: 2,
      status: "dry_run",
    });
    expect(db.inserted).toEqual([]);
  });

  it("completes partial saved invoice items without duplicating existing rows", async () => {
    const existing = phifItem("ACTUAL-1", "Atorvastatin", "20MG", "Actual Supplier", "actual-supplier");
    const missing = phifItem("PHIF-A", "Amlodipine", "5MG");
    const db = fakePhifItemsDb({ "invoice-partial": [existing] });
    const invoice = {
      id: "invoice-partial",
      invoice_key: "2026-partial-key",
      invoice_number: "3499535",
      dispensing_date: "2026-07-31",
    };
    const fetchInvoice = async () => ({
      invoice_key: invoice.invoice_key,
      invoice_number: invoice.invoice_number,
      insurance_card_number: "0061600113888",
      beneficiary_name: "Test",
      dispensing_date: invoice.dispensing_date,
      dispensing_time: null,
      status: "confirmed",
      metadata: {},
      items: [existing, missing],
    });

    const firstRun = await completeSavedPhifInvoiceItemsFromSource({
      db,
      dryRun: false,
      invoices: [invoice],
      fetchInvoice,
    });
    expect(firstRun.completed_invoice_count).toBe(1);
    expect(firstRun.added_item_count).toBe(1);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({
      phif_invoice_id: "invoice-partial",
      phif_item_id: "PHIF-A",
      source_classification: "phif-supplier",
    });

    const secondRun = await completeSavedPhifInvoiceItemsFromSource({
      db,
      dryRun: false,
      invoices: [invoice],
      fetchInvoice,
    });
    expect(secondRun.completed_invoice_count).toBe(0);
    expect(secondRun.added_item_count).toBe(0);
    expect(db.inserted).toHaveLength(1);
  });

  it("builds independent 28-day PHIF medication cycles per item", () => {
    const invoices = [
      { id: "invoice-1", invoice_key: "INV-1", invoice_number: "1", dispensing_date: "2026-09-01", status: "ok" },
      { id: "invoice-2", invoice_key: "INV-2", invoice_number: "2", dispensing_date: "2026-09-10", status: "ok" },
    ];
    const profile = buildPhifMedicationProfileFromRows(invoices, [
      {
        phif_invoice_id: "invoice-1",
        phif_item_id: "A",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Glucophage",
        quantity: 2,
        metadata: { dosage_form: "tablet" },
      },
      {
        phif_invoice_id: "invoice-2",
        phif_item_id: "B",
        active_ingredient: "Amlodipine",
        strength: "5 mg",
        brand: "Norvasc",
        quantity: 1,
        metadata: { dosage_form: "tablet" },
      },
    ]);

    expect(profile.items).toHaveLength(2);
    expect(profile.items.map((item) => item.next_due_date).sort()).toEqual(["2026-09-29", "2026-10-08"]);
    expect(profile.nearest_due_date).toBe("2026-09-29");
    expect(profile.nearest_due_items).toEqual(["Metformin 500 mg"]);
    expect(profile.nearest_due_item_count).toBe(1);
    expect(profile.due_summaries.map((due) => due.next_due_date)).toEqual(["2026-09-29", "2026-10-08"]);
  });

  it("groups PHIF due summaries by unique due date instead of listing every item", () => {
    const summaries = buildPhifDueSummaries([
      { next_due_date: "2026-10-22" },
      { next_due_date: "2026-10-22" },
      { next_due_date: "2026-10-30" },
      { next_due_date: null },
    ]);

    expect(summaries.map((due) => [due.next_due_date, due.item_count])).toEqual([
      ["2026-10-22", 2],
      ["2026-10-30", 1],
    ]);
  });

  it("uses PHIF due summaries as Tiryaq operational due tracks without manual merging", () => {
    const phifDue = phifDueSummariesToTracks([
      { next_due_date: "2026-10-22", item_count: 3, days_until_due: 27 },
      { next_due_date: "2026-10-30", item_count: 1, days_until_due: 35 },
    ]);

    expect(phifDue).toHaveLength(2);
    expect(phifDue[0]).toMatchObject({
      id: "phif:2026-10-22",
      next_due_date: "2026-10-22",
      source: "phif",
      phif_item_count: 3,
    });

    const phifRows = buildPhifHistoryRows(
      {
        reconciliation: [],
        items: [
          {
            identity_key: "a",
            movements: [
              {
                invoice_id: "invoice-1",
                invoice_key: "INV-1",
                invoice_number: "4336548",
                dispensing_date: "2026-09-24",
                active_ingredient: "Amlodipine",
                strength: "5MG",
                brand: null,
                quantity: 30,
                source_classification: "phif-supplier",
              },
            ],
          },
          {
            identity_key: "b",
            movements: [
              {
                invoice_id: "invoice-1",
                invoice_key: "INV-1",
                invoice_number: "4336548",
                dispensing_date: "2026-09-24",
                active_ingredient: "Atorvastatin",
                strength: "20MG",
                brand: "Lipover",
                quantity: 28,
                source_classification: "actual-supplier",
              },
            ],
          },
        ],
      },
      "tiryaq",
      "صيدلية الترياق الشافي",
    );

    expect(phifRows).toHaveLength(1);
    expect(phifRows[0].source).toBe("phif");
    expect(phifRows[0].items_dispensed).toBe(2);
    expect(phifRows[0].phif_items).toHaveLength(2);
    expect(phifRows[0].invoice_number).toBe("4336548");
  });

  it("keeps repeated PHIF movements under one item and flags repeats under 28 days", () => {
    const invoices = [
      { id: "invoice-1", invoice_key: "INV-1", invoice_number: "1", dispensing_date: "2026-09-01", status: "ok" },
      { id: "invoice-2", invoice_key: "INV-2", invoice_number: "2", dispensing_date: "2026-09-15", status: "ok" },
    ];
    const profile = buildPhifMedicationProfileFromRows(invoices, [
      {
        phif_invoice_id: "invoice-1",
        phif_item_id: "A",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Glucophage",
        quantity: 2,
        metadata: { dosage_form: "tablet" },
      },
      {
        phif_invoice_id: "invoice-2",
        phif_item_id: "A",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Glucophage",
        quantity: 2,
        metadata: { dosage_form: "tablet" },
      },
    ]);

    expect(profile.items).toHaveLength(1);
    expect(profile.items[0].movements).toHaveLength(2);
    expect(profile.items[0].needs_review).toBe(true);
    expect(profile.items[0].review_reasons.join(" ")).toContain("أقل من 28");
  });

  it("groups the same PHIF medication despite brand or PHIF item id differences", () => {
    expect(
      phifMedicationIdentityKey({
        phif_item_id: "PHIF-1",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Brand A",
        metadata: { dosage_form: "tablet" },
      }),
    ).toBe(
      phifMedicationIdentityKey({
        phif_item_id: "PHIF-2",
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Brand B",
        metadata: { dosage_form: "tablet" },
      }),
    );
  });

  it("keeps different PHIF strengths and forms as separate medication identities", () => {
    expect(
      phifMedicationIdentityKey({
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Brand A",
        metadata: { dosage_form: "tablet" },
      }),
    ).not.toBe(
      phifMedicationIdentityKey({
        active_ingredient: "Metformin",
        strength: "850 mg",
        brand: "Brand A",
        metadata: { dosage_form: "tablet" },
      }),
    );
    expect(
      phifMedicationIdentityKey({
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Brand A",
        metadata: { dosage_form: "tablet" },
      }),
    ).not.toBe(
      phifMedicationIdentityKey({
        active_ingredient: "Metformin",
        strength: "500 mg",
        brand: "Brand A",
        metadata: { dosage_form: "syrup" },
      }),
    );
  });

  it("uses the latest PHIF movement for the current due date without duplicating medication cards", () => {
    const invoices = [
      { id: "invoice-1", invoice_key: "INV-1", invoice_number: "4354537", dispensing_date: "2026-09-01", status: "ok" },
      { id: "invoice-2", invoice_key: "INV-2", invoice_number: "4352696", dispensing_date: "2026-09-26", status: "ok" },
    ];
    const profile = buildPhifMedicationProfileFromRows(invoices, [
      {
        phif_invoice_id: "invoice-1",
        phif_item_id: "PHIF-A",
        active_ingredient: "Atorvastatin",
        strength: "40 MG",
        brand: "Old Brand",
        quantity: 30,
        metadata: { dosage_form: "tablet" },
        source_classification: "phif-supplier",
      },
      {
        phif_invoice_id: "invoice-2",
        phif_item_id: "ACTUAL-A",
        active_ingredient: "ATORVASTATIN",
        strength: "40MG",
        brand: "New Brand",
        quantity: 28,
        metadata: { dosage_form: "tablet" },
        source_classification: "actual-supplier",
      },
    ]);

    expect(profile.items).toHaveLength(1);
    expect(profile.items[0].movements).toHaveLength(2);
    expect(profile.items[0].latest_dispensing_date).toBe("2026-09-26");
    expect(profile.items[0].next_due_date).toBe("2026-10-24");
    expect(profile.due_summaries).toEqual([
      expect.objectContaining({ next_due_date: "2026-10-24", item_count: 1 }),
    ]);
  });

  it("builds read-only manual dispensing reconciliation preview", () => {
    const profile = buildPhifMedicationProfileFromRows(
      [
        { id: "invoice-1", invoice_key: "INV-1", invoice_number: "1", dispensing_date: "2026-09-01", status: "ok" },
        { id: "invoice-2", invoice_key: "INV-2", invoice_number: "2", dispensing_date: "2026-09-10", status: "ok" },
      ],
      [],
      [
        { id: "tx-1", dispensing_date: "2026-09-01", transaction_type: "Completed", is_cancelled: false },
        { id: "tx-2", dispensing_date: "2026-09-13", transaction_type: "Completed", is_cancelled: false },
      ],
    );

    expect(profile.reconciliation.map((row) => row.kind)).toContain("manual_matches_phif");
    expect(profile.reconciliation.map((row) => row.kind)).toContain("date_mismatch");
  });

  it("defines invoice deduplication within each pharmacy only", () => {
    const migration = readProjectFile("supabase/migrations/20260918010000_add_phif_sync_tables.sql");
    expect(migration).toContain("phif_invoices_pharmacy_invoice_key_uidx");
    expect(migration).toContain("ON public.phif_invoices (pharmacy_id, invoice_key)");

    const source = readProjectFile("src/lib/phif-sync.functions.ts");
    expect(source).toContain('.from("phif_invoices")');
    expect(source).toContain("insertMissingPhifInvoiceItems");
    expect(source).toContain("existingPhifInvoiceItems");
    expect(source).toContain("filterMissingPhifInvoiceItems(detail.items");
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

  it("adds a read-only PHIF invoice archive scoped to Tiryaq server-side", () => {
    const source = readProjectFile("src/lib/phif-invoices.functions.ts");
    const listRoute = readProjectFile("src/routes/phif-invoices.index.tsx");
    const detailRoute = readProjectFile("src/routes/phif-invoices.$id.tsx");
    const syncRoute = readProjectFile("src/routes/phif-sync.tsx");

    expect(source).toContain("requireTiryaqPhifArchiveAccess");
    expect(source).toContain('session.pharmacy_name !== TIRYAQ_PHARMACY_NAME');
    expect(source).toContain('.from("phif_invoices")');
    expect(source).toContain('.from("phif_invoice_items")');
    expect(source).toContain('.eq("pharmacy_id", pharmacy_id)');
    expect(source).toContain("insurance_card_number");
    expect(source).toContain("beneficiary_name");
    expect(source).toContain("invoice_number");
    expect(source).not.toContain('.from("dispensing_transactions").insert');
    expect(source).not.toContain('.from("patients").insert');
    expect(source).not.toContain("PHIF_BRIDGE_SECRET");
    expect(source).not.toContain("bridge_session_id");

    expect(listRoute).toContain("فواتير PHIF");
    expect(listRoute).toContain("listPhifInvoices");
    expect(detailRoute).toContain("getPhifInvoiceDetail");
    expect(syncRoute).toContain("getPhifInvoiceArchiveStats");
    expect(syncRoute).toContain("فتح الأرشيف");
  });

  it("adds persistent PHIF invoice review and patient-link state without touching dispensing", () => {
    const migration = readProjectFile("supabase/migrations/20260924010000_add_phif_invoice_patient_review.sql");
    const source = readProjectFile("src/lib/phif-invoices.functions.ts");
    const reviewRoute = readProjectFile("src/routes/phif-review.tsx");
    const patientRoute = readProjectFile("src/routes/patients.$id.tsx");

    expect(migration).toContain("ADD COLUMN IF NOT EXISTS patient_id");
    expect(migration).toContain("REFERENCES public.patients(id) ON DELETE SET NULL");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS review_status");
    expect(migration).toContain("review_status IN ('pending','linked','rejected')");
    expect(migration).not.toContain("dispensing_transactions");
    expect(migration).not.toContain("dispensing_due_tracks");
    expect(migration).not.toContain("dispensing_cycles");

    expect(source).toContain("listPhifReviewCases");
    expect(source).toContain("createPatientFromPhifInvoice");
    expect(source).toContain("linkPhifInvoicesToPatient");
    expect(source).toContain("rejectPhifReviewCase");
    expect(source).toContain("reopenPhifReviewCase");
    expect(source).toContain("listPatientPhifInvoices");
    expect(source).toContain("getPatientPhifMedicationProfile");
    expect(source).toContain("buildPhifMedicationProfileFromRows");
    expect(source).toContain("requireTiryaqPhifArchiveAccess");
    expect(source).toContain("confirm_card_mismatch");
    expect(source).toContain("يوجد مستفيد بنفس رقم البطاقة بالفعل");
    expect(source).toContain('review_status: "linked"');
    expect(source).toContain('review_status: "rejected"');
    expect(source).not.toContain('.from("dispensing_transactions").insert');
    expect(source).not.toContain('.from("dispensing_due_tracks")');
    expect(source).not.toContain('.from("dispensing_cycles")');

    expect(reviewRoute).toContain("مراجعة فواتير PHIF");
    expect(reviewRoute).toContain("إضافة مستفيد");
    expect(reviewRoute).toContain("ربط بمستفيد موجود");
    expect(reviewRoute).toContain("رفض");
    expect(reviewRoute).toContain("إعادة فتح");
    expect(patientRoute).toContain("listPatientPhifInvoices");
    expect(patientRoute).toContain("getPatientPhifMedicationProfile");
    expect(patientRoute).toContain("الملف الدوائي PHIF");
    expect(patientRoute).toContain("فواتير PHIF");
  });

  it("supports confirmed multi-card PHIF patient linking without automatic name merges", () => {
    const migration = readProjectFile("supabase/migrations/20260925010000_add_patient_insurance_cards.sql");
    const source = readProjectFile("src/lib/phif-invoices.functions.ts");
    const readsSource = readProjectFile("src/lib/reads.functions.ts");
    const queriesSource = readProjectFile("src/lib/queries.ts");
    const listRoute = readProjectFile("src/routes/patients.index.tsx");
    const patientRoute = readProjectFile("src/routes/patients.$id.tsx");
    const reviewRoute = readProjectFile("src/routes/phif-review.tsx");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.patient_insurance_cards");
    expect(migration).toContain("card_number text NOT NULL");
    expect(migration).toContain("patient_insurance_cards_card_number_uidx");
    expect(migration).toContain("patient_insurance_cards_one_current_uidx");
    expect(migration).toContain("REVOKE ALL ON public.patient_insurance_cards FROM anon, authenticated");
    expect(migration).not.toContain("dispensing_transactions");
    expect(migration).not.toContain("phif_invoices SET insurance_card_number");

    expect(source).toContain("listPatientInsuranceCards");
    expect(source).toContain("addPatientInsuranceCard");
    expect(source).toContain("setCurrentPatientInsuranceCard");
    expect(source).toContain("assertCardIsNotOwnedByAnotherPatient");
    expect(source).toContain("patientInsuranceCards");
    expect(source).toContain("patientInsuranceCardRows");
    expect(source).toContain("patient_insurance_cards");
    expect(source).toContain("جدول بطاقات المستفيد غير مطبق بعد");
    expect(source).toContain("await setCurrentPatientInsuranceCard(db, data.patient_id, card, \"phif_review\")");
    expect(source).toContain("await setCurrentPatientInsuranceCard(db, inserted.id, card, \"phif_review\")");
    expect(reviewRoute).toContain("لا يتم الربط اعتمادًا على تشابه الاسم وحده");

    expect(readsSource).toContain("loadPatientInsuranceCardsByIds");
    expect(readsSource).toContain("insurance_cards");
    expect(queriesSource).toContain("insurance_cards?");
    expect(queriesSource).toContain("card.card_number.includes(q)");
    expect(listRoute).toContain("card.card_number.includes(qd)");

    expect(patientRoute).toContain("InsuranceCardsPanel");
    expect(patientRoute).toContain("بطاقة سابقة");
    expect(patientRoute).toContain("تأكيد ربط بطاقة جديدة");
    expect(patientRoute).toContain("migration مطلوب");
    expect(patientRoute).toContain("patient_insurance_cards");
  });

  it("adds explicit patient pharmacy access for shared identity without exposing other pharmacy operations", () => {
    const migration = readProjectFile("supabase/migrations/20260926010000_add_patient_pharmacy_access.sql");
    const isolation = readProjectFile("src/lib/pharmacy-isolation.ts");
    const invoices = readProjectFile("src/lib/phif-invoices.functions.ts");
    const dispensing = readProjectFile("src/lib/dispensing.functions.ts");
    const reviewRoute = readProjectFile("src/routes/phif-review.tsx");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.patient_pharmacy_access");
    expect(migration).toContain("patient_pharmacy_access_patient_pharmacy_uidx");
    expect(migration).toContain("FROM public.audit_log al");
    expect(migration).toContain("al.action = 'create_patient'");
    expect(migration).toContain("SELECT DISTINCT dt.patient_id, dt.pharmacy_id");
    expect(migration).toContain("SELECT DISTINCT pi.patient_id, pi.pharmacy_id");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.v_patient_pharmacy_access_unassigned");
    expect(migration).toContain("Do not auto-link them to any pharmacy without manual verification");
    expect(migration).toContain("REVOKE ALL ON public.patient_pharmacy_access FROM anon, authenticated");

    expect(isolation).toContain("ensurePatientPharmacyAccess");
    expect(isolation).toContain("patient_pharmacy_access");
    expect(isolation).toContain("patientAccessTableAvailable");
    expect(isolation).toContain("patientHasSessionAccess");
    expect(isolation).toContain('if (hasAccessTable) return false');
    expect(isolation).toContain('.from("patients")');
    expect(isolation).toContain('for (const r of rows) anyTx.add(r.id)');

    expect(invoices).toContain("needs_existing_patient_confirmation");
    expect(invoices).toContain("confirm_existing_patient");
    expect(invoices).toContain("existing_added_to_pharmacy");
    expect(invoices).toContain("رقم البطاقة مرتبط ببيانات متعارضة");
    expect(invoices).toContain("await ensurePatientPharmacyAccess(db, pharmacy_id, existingOwner.patient_id, \"phif_review\")");
    expect(invoices).toContain('await db.from("patients").delete().eq("id", inserted.id)');
    expect(dispensing).toContain("ensurePatientPharmacyAccess");
    expect(dispensing).toContain('await supabaseAdmin.from("patients").delete().eq("id", inserted.id)');
    expect(dispensing).toContain("patient_pharmacy_access_missing");
    expect(reviewRoute).toContain("تأكيد إضافة المستفيد الحالي");
  });

  it("uses PHIF invoices as Tiryaq operational dispensing source while archiving old manual rows", () => {
    const readsSource = readProjectFile("src/lib/reads.functions.ts");
    const patientCard = readProjectFile("src/components/PatientCard.tsx");
    const patientRoute = readProjectFile("src/routes/patients.$id.tsx");

    expect(readsSource).toContain("TIRYAQ_PHARMACY_NAME");
    expect(readsSource).toContain("loadPhifStatusProfiles");
    expect(readsSource).toContain("phifDueSummariesToTracks");
    expect(readsSource).toContain("resetManualOperationalStatus");
    expect(readsSource).toContain("getPatientManualArchive");
    expect(readsSource).toContain("source: \"phif\"");
    expect(readsSource).toContain("phifRowsByInvoice");
    expect(readsSource).toContain('.from("phif_invoices")');
    expect(readsSource).toContain('.from("phif_invoice_items")');
    expect(readsSource).not.toContain('.not("patient_id", "is", null)');
    expect(readsSource).not.toContain('.from("dispensing_transactions").insert');
    expect(readsSource).not.toContain('.from("dispensing_due_tracks").insert');
    expect(readsSource).not.toContain('.from("dispensing_cycles").insert');

    expect(patientCard).toContain("phif_item_count");
    expect(patientCard).toContain("slice(0, 3)");
    expect(patientRoute).toContain('h.source === "phif"');
    expect(patientRoute).toContain("أرشيف الصرف اليدوي القديم");
    expect(patientRoute).toContain("يحتاج مراجعة ازدواج");
    expect(patientRoute).toContain("صرف يدوي جديد غير مسجل في PHIF");
    expect(patientRoute).toContain("nearest_due_item_count");
    expect(patientRoute).not.toContain("profile.nearest_due_items?.join");
  });

  it("renders PHIF invoice and medication profile with mobile-first review UI", () => {
    const detailRoute = readProjectFile("src/routes/phif-invoices.$id.tsx");
    const patientRoute = readProjectFile("src/routes/patients.$id.tsx");

    expect(detailRoute).toContain("SourceLabel");
    expect(detailRoute).toContain("itemNameWithStrength");
    expect(detailRoute).toContain("min-w-[620px]");
    expect(detailRoute).toContain("PHIF");
    expect(detailRoute).toContain("Actual");
    expect(detailRoute).toContain("طباعة الفاتورة");
    expect(detailRoute).toContain("تفاصيل إضافية");
    expect(detailRoute).toContain("print:hidden");
    expect(detailRoute).toContain("formatMoney");

    expect(patientRoute).toContain("CompactPhifMedicationProfileCard");
    expect(patientRoute).toContain("phifMedicationName");
    expect(patientRoute).toContain("phifMovementName");
    expect(patientRoute).toContain("آخر صرف:");
    expect(patientRoute).toContain("الاستحقاق:");
    expect(patientRoute).toContain("<details");
    expect(patientRoute).not.toContain("item.brand || item.active_ingredient");
  });

  it("adds server-only PHIF stock snapshot tables without touching invoices or dispensing", () => {
    const migration = readProjectFile("supabase/migrations/20260928010000_add_phif_stock_snapshots.sql");
    expect(migration).toContain("CREATE TABLE public.phif_stock_sync_runs");
    expect(migration).toContain("CREATE TABLE public.phif_stock_items");
    expect(migration).toContain("source_stock_id text NOT NULL");
    expect(migration).toContain("cost_price numeric(18, 6)");
    expect(migration).toContain("sale_price numeric(18, 6)");
    expect(migration).toContain("phif_stock_items_snapshot_uidx");
    expect(migration).toContain("phif_stock_items_current_source_uidx");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.replace_phif_stock_snapshots");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.replace_phif_stock_snapshots");
    expect(migration).toContain("ALTER TABLE public.phif_stock_items ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.phif_stock_items FROM anon, authenticated");
    expect(migration).not.toContain("dispensing_transactions");
    expect(migration).not.toContain("phif_invoices");
  });

  it("normalizes complete PHIF stock response while preserving decimal strings and missing nested fields", () => {
    const rows = normalizePhifStockRows({
      recordsTotal: 2,
      data: [
        {
          id: 10,
          pharmacies_id: 55,
          genaric_names_id: 77,
          medical_suppliers_id: 88,
          supplier_brand_name_id: 99,
          patsh_numbers_id: 111,
          quantity: "12.500",
          supplier_brand_name: {
            brand_name: "FORMIN",
            unit: "tablet",
            doses: "500mg",
            package_quantity: "30",
            strips_quantity: "3",
            cost_price: "0.284",
            sale_price: "0.340",
            factory_price: "0.250",
          },
          patsh_numbers: {
            batch_number: "B-001",
            expiry_date: "2027-05-01",
          },
          medical_supplier: { name: "Supplier A" },
          genaric_name: { name: "METFORMIN" },
        },
        {
          id: 11,
          quantity: null,
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source_stock_id: "10",
      source_pharmacy_id: "55",
      generic_ingredient_id: "77",
      supplier_id: "88",
      brand_product_id: "99",
      batch_id: "111",
      brand_name: "FORMIN",
      active_ingredient: "METFORMIN",
      strength: "500mg",
      stock_quantity: "12.500",
      cost_price: "0.284",
      sale_price: "0.340",
      batch_number: "B-001",
      expiry_date: "2027-05-01",
    });
    expect(rows[1].source_stock_id).toBe("11");
    expect(rows[1].brand_name).toBeNull();
    expect(rows[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps PHIF stock read-only through the bridge and protects cost prices server-side", () => {
    const bridgeClient = readProjectFile("phif-bridge/phif/client.js");
    const bridgeServer = readProjectFile("phif-bridge/server.js");
    const stockFunctions = readProjectFile("src/lib/phif-stock.functions.ts");
    const route = readProjectFile("src/routes/management.inventory.tsx");

    expect(bridgeClient).toContain('/^\\/get-pharmacy-stock$/');
    expect(bridgeServer).toContain('action === "stock"');
    expect(bridgeServer).toContain('client.getJson("/get-pharmacy-stock")');
    expect(bridgeServer).toContain("PHIF_TIRYAQ_SOURCE_PHARMACY_ID");
    expect(bridgeServer).toContain("validateStockSourcePharmacy");
    expect(bridgeServer).not.toContain('postForm("/get-pharmacy-stock"');
    expect(stockFunctions).toContain('requireTiryaqPermission("inventory_read")');
    expect(stockFunctions).not.toContain("PHIF_TIRYAQ_SOURCE_PHARMACY_ID");
    expect(stockFunctions).not.toContain("assertExpectedTiryaqStockSource");
    expect(stockFunctions).toContain('rpc("replace_phif_stock_snapshots"');
    expect(stockFunctions).toContain('"stock_cost_read"');
    expect(stockFunctions).toContain("const { cost_price, ...safe } = row");
    expect(stockFunctions).toContain('.from("phif_stock_items")');
    expect(route).toContain("syncPhifStock");
    expect(route).toContain("canViewCost");
  });

  it("formats PHIF stock strips as boxes without using package quantity", () => {
    expect(stockQuantityBreakdown(3, 2).label).toBe("1 علبة + 1 شريط");
    expect(stockQuantityBreakdown(6, 2).label).toBe("3 علب");
    expect(stockQuantityBreakdown(1, 2).label).toBe("1 شريط");
    expect(stockQuantityBreakdown(1, null, "شريط").label).toBe("1 شريط");
  });

  it("keeps PHIF stock cost server-side when stock_cost_read is missing", () => {
    const source = readProjectFile("src/lib/phif-stock.functions.ts");
    const route = readProjectFile("src/routes/management.inventory.tsx");

    expect(source).toContain("const { cost_price, ...safe } = row");
    expect(source).toContain('"stock_cost_read"');
    expect(route).toContain("can_view_cost");
    expect(route).toContain("canViewCost &&");
  });

  it("matches Actual invoice items by commercial identity instead of scientific name alone", () => {
    const stock = [
      {
        source_stock_id: "stock-1",
        brand_name: "FORMIN",
        active_ingredient: "Metformin",
        strength: "500mg",
        cost_price: "0.200",
        sale_price: "0.340",
        synced_at: "2026-09-20T10:00:00Z",
      },
    ];
    const actualItem = {
      brand: "Formin",
      active_ingredient: "Metformin",
      strength: "500 mg",
      quantity: 30,
      source_classification: "actual-supplier",
      phif_financial_fields: { sale_price: "0.340", total_amount: "10.200" },
      metadata: {},
    };

    expect(matchActualInvoiceItemToStock(actualItem, stock)).toMatchObject({ status: "matched" });
    expect(calculateActualGrossMargin(actualItem, stock)).toMatchObject({
      status: "matched",
      invoiceValue: 10.2,
      purchaseCost: 6,
    });
  });

  it("marks ambiguous Actual stock matches for review instead of choosing automatically", () => {
    const item = {
      brand: "Karbis",
      strength: "16 mg",
      quantity: 30,
      source_classification: "actual-supplier",
      phif_financial_fields: {},
      metadata: {},
    };
    const candidates = [
      { source_stock_id: "a", brand_name: "Karbis", strength: "16mg", cost_price: "1" },
      { source_stock_id: "b", brand_name: "Karbis", strength: "16mg", cost_price: "2" },
    ];

    expect(matchActualInvoiceItemToStock(item, candidates)).toMatchObject({
      status: "needs_match_review",
      reason: "ambiguous_match",
    });
  });

  it("does not replace invoice sale value while calculating Actual margin", () => {
    const item = {
      brand: "Formin",
      strength: "500 mg",
      quantity: 30,
      source_classification: "actual-supplier",
      phif_financial_fields: { sale_price: "0.340", total_amount: "10.200" },
      metadata: {},
    };

    expect(calculateActualGrossMargin(item, [{ source_stock_id: "old", brand_name: "Formin", strength: "500mg", cost_price: "0.200" }])).toMatchObject({
      invoiceValue: 10.2,
      purchaseCost: 6,
    });
  });

  it("does not use later stock snapshots to recalculate older invoice margins", () => {
    const snapshots = [
      { source_stock_id: "old", brand_name: "Formin", strength: "500mg", cost_price: "0.200", synced_at: "2026-09-20T10:00:00Z" },
      { source_stock_id: "new", brand_name: "Formin", strength: "500mg", cost_price: "0.300", synced_at: "2026-10-20T10:00:00Z" },
    ];

    expect(stockSnapshotCandidatesForInvoice({ brand: "Formin", strength: "500 mg" }, snapshots, "2026-09-25").map((row) => row.source_stock_id)).toEqual(["old"]);
  });

  it("does not mix Actual margin calculation with PHIF Supplier items", () => {
    const result = calculateActualGrossMargin(
      {
        brand: "Supplier Item",
        strength: "5 mg",
        quantity: 30,
        source_classification: "phif-supplier",
        phif_financial_fields: { total_amount: "15.000" },
        metadata: {},
      },
      [{ source_stock_id: "stock", brand_name: "Supplier Item", strength: "5mg", cost_price: "0.100" }],
    );

    expect(result).toMatchObject({
      status: "phif_supplier_excluded",
      purchaseCost: null,
      grossMargin: null,
    });
  });
});
