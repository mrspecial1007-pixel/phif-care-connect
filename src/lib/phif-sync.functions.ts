import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PhifTransactionSummary = {
  invoice_key: string;
  invoice_id: string | null;
  beneficiary_code: string | null;
  beneficiary_name: string | null;
  status: string | null;
  action: string | null;
};

export type PhifInvoiceItemPreview = {
  phif_item_id: string | null;
  active_ingredient: string | null;
  strength: string | null;
  brand: string | null;
  quantity: number | null;
  supplier: string | null;
  source_classification: string | null;
  phif_financial_fields: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type PhifInvoicePreview = {
  invoice_key: string;
  invoice_number: string | null;
  insurance_card_number: string | null;
  beneficiary_name: string | null;
  dispensing_date: string | null;
  dispensing_time: string | null;
  status: string | null;
  metadata: Record<string, unknown>;
  items: PhifInvoiceItemPreview[];
  patient_match: "matched" | "not_matched";
  patient_id: string | null;
};

type BridgeSessionRecord = {
  bridge_session_id: string;
  pharmacy_id: string;
  login_url: string | null;
  expires_at: string;
};

type PhifSessionStatusResult = {
  configured: boolean;
  authenticated: boolean;
  login_url: string | null;
  expires_at: string | null;
  message: string;
};

const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:5174";
const DEFAULT_BRIDGE_PUBLIC_BASE_URL = "https://phif-bridge.altiryaq-pharma.com";
const COMMON_FINANCIAL_KEYS = [
  "price",
  "amount",
  "total",
  "net",
  "gross",
  "copay",
  "coPay",
  "covered",
  "phifValue",
  "phif_value",
  "patientShare",
  "patient_share",
  "insuranceValue",
  "insurance_value",
];

function pickString(obj: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj?.[key];
    if (value === undefined || value === null || value === "") continue;
    const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function normalizePhifCard(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  return value || null;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(raw);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function normalizeTime(raw: string | null): string | null {
  if (!raw) return null;
  const match = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!match) return null;
  const h = match[1].padStart(2, "0");
  const m = match[2];
  const s = match[3]?.padStart(2, "0") ?? "00";
  return `${h}:${m}:${s}`;
}

function firstArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "transactions", "rows", "result", "aaData"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

export function parsePhifTodayTransactions(payload: unknown): PhifTransactionSummary[] {
  return firstArray(payload)
    .map((row: any) => {
      const invoiceId = pickString(row, ["invoiceId", "invoice_id", "invoiceID", "id"]);
      const invoiceKey = pickString(row, ["invoice_key", "invoiceKey", "invoiceId", "id", "key"]);
      if (!invoiceKey) return null;
      return {
        invoice_key: invoiceKey,
        invoice_id: invoiceId,
        beneficiary_code: pickString(row, ["beneficiaryCode", "beneficiary_code", "regnumber"]),
        beneficiary_name: pickString(row, ["beneficiaryName", "beneficiary_name", "name"]),
        status: pickString(row, ["status"]),
        action: pickString(row, ["action"]),
      };
    })
    .filter(Boolean) as PhifTransactionSummary[];
}

export function classifyPhifItemSource(item: Record<string, unknown>): string | null {
  const explicit = pickString(item, ["source_classification", "sourceClassification", "sourceType", "source"]);
  const supplier = pickString(item, [
    "supplier",
    "supplierName",
    "supplier_name",
    "supplier_commercial_name",
    "supplierCommercialName",
  ]);
  const text = `${explicit ?? ""} ${supplier ?? ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (text.includes("phif-supplier") || text.includes("phif supplier")) return "phif-supplier";
  if (text.includes("actual")) return "actual-supplier";
  return explicit ?? "actual-supplier";
}

function extractFinancialFields(item: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of COMMON_FINANCIAL_KEYS) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== "") out[key] = item[key];
  }
  const nested = (item as any).phif ?? (item as any).financial ?? (item as any).financials;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested)) {
      if (value !== undefined && value !== null && value !== "") out[key] = value;
    }
  }
  return out;
}

function extractItems(payload: any): any[] {
  for (const key of ["items", "medications", "drugs", "details", "invoiceItems", "transactionItems"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.data?.medications)) return payload.data.medications;
  return [];
}

export function parsePhifTransactionDetail(invoiceKey: string, payload: unknown): Omit<PhifInvoicePreview, "patient_match" | "patient_id"> {
  const root = (payload as any)?.data && typeof (payload as any).data === "object" && !Array.isArray((payload as any).data)
    ? (payload as any).data
    : (payload as any);
  const rawDateTime = pickString(root, ["dispensing_datetime", "dispensingDateTime", "dateTime", "created_at"]);
  const rawDate = pickString(root, ["dispensing_date", "dispensingDate", "date", "invoiceDate"]) ?? rawDateTime;
  const rawTime = pickString(root, ["dispensing_time", "dispensingTime", "time"]) ?? rawDateTime;

  const items = extractItems(root).map((item: any) => ({
    phif_item_id: pickString(item, ["id", "itemId", "item_id", "phif_item_id", "code"]),
    active_ingredient: pickString(item, [
      "active_ingredient",
      "activeIngredient",
      "generic",
      "genericName",
      "scientific_name",
      "material",
    ]),
    strength: pickString(item, ["strength", "doses", "dose", "concentration"]),
    brand: pickString(item, ["brand", "brand_name", "brandName", "commercialName", "commercial_name"]),
    quantity: pickNumber(item, ["quantity", "qty", "dispensedQuantity", "dispensed_quantity"]),
    supplier: pickString(item, [
      "supplier",
      "supplierName",
      "supplier_name",
      "supplierCommercialName",
      "supplier_commercial_name",
    ]),
    source_classification: classifyPhifItemSource(item),
    phif_financial_fields: extractFinancialFields(item),
    metadata: {},
  }));

  return {
    invoice_key: invoiceKey,
    invoice_number: pickString(root, ["invoice_number", "invoiceNumber", "invoiceNo", "invoice_id", "invoiceId"]),
    insurance_card_number: normalizePhifCard(
      pickString(root, ["insurance_card_number", "insuranceCardNumber", "beneficiaryCode", "cardNumber", "regnumber"]),
    ),
    beneficiary_name: pickString(root, ["beneficiary_name", "beneficiaryName", "patientName", "name"]),
    dispensing_date: normalizeDate(rawDate),
    dispensing_time: normalizeTime(rawTime),
    status: pickString(root, ["status"]),
    metadata: {},
    items,
  };
}

function bridgeBaseUrl() {
  const base = process.env.PHIF_BRIDGE_BASE_URL?.trim() || DEFAULT_BRIDGE_BASE_URL;
  return base.replace(/\/+$/, "");
}

function bridgePublicBaseUrl() {
  const base = process.env.PHIF_BRIDGE_PUBLIC_BASE_URL?.trim() || DEFAULT_BRIDGE_PUBLIC_BASE_URL;
  return base.replace(/\/+$/, "");
}

function bridgeSecret() {
  return process.env.PHIF_BRIDGE_SECRET?.trim() || null;
}

function publicForwardHeaders() {
  const publicBase = new URL(bridgePublicBaseUrl());
  return {
    "X-Forwarded-Proto": publicBase.protocol.replace(":", ""),
    "X-Forwarded-Host": publicBase.host,
  };
}

function assertBridgeConfigured() {
  const secret = bridgeSecret();
  if (!secret) throw new Error("PHIF bridge secret is not configured");
  return { base: bridgeBaseUrl(), secret };
}

function isSessionFresh(session: BridgeSessionRecord | undefined) {
  if (!session?.bridge_session_id || !session.expires_at) return false;
  return Date.parse(session.expires_at) > Date.now() + 60_000;
}

async function bridgeJson(
  path: string,
  {
    method = "GET",
    pharmacyId,
    body,
  }: {
    method?: "GET" | "POST" | "DELETE";
    pharmacyId?: string;
    body?: unknown;
  } = {},
) {
  const { base, secret } = assertBridgeConfigured();
  const headers = new Headers({
    "X-PHIF-Bridge-Secret": secret,
    ...publicForwardHeaders(),
  });
  if (pharmacyId) headers.set("X-Pharmacy-Id", pharmacyId);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { ok: false, error: text || `PHIF bridge request failed: ${res.status}` };
  }
  if (!res.ok) throw new Error(payload?.error ?? `PHIF bridge request failed: ${res.status}`);
  return payload;
}

async function createBridgeSession(pharmacyId: string): Promise<BridgeSessionRecord> {
  const payload = await bridgeJson("/api/bridge-sessions", {
    method: "POST",
    body: { pharmacy_id: pharmacyId },
  });
  return {
    bridge_session_id: payload.session.bridge_session_id,
    pharmacy_id: pharmacyId,
    login_url: payload.login_url ?? null,
    expires_at: payload.session.expires_at,
  };
}

async function storeBridgeSession(admin: any, pharmacyId: string, session: BridgeSessionRecord) {
  const now = new Date().toISOString();
  const { error: deactivateError } = await admin
    .from("phif_bridge_sessions")
    .update({ status: "inactive", updated_at: now })
    .eq("pharmacy_id", pharmacyId)
    .eq("status", "active");
  if (deactivateError) throw new Error(deactivateError.message);

  const { error: insertError } = await admin
    .from("phif_bridge_sessions")
    .insert({
      pharmacy_id: pharmacyId,
      bridge_session_id: session.bridge_session_id,
      expires_at: session.expires_at,
      status: "active",
      last_checked_at: now,
    });
  if (insertError) throw new Error(insertError.message);
  return session;
}

async function markBridgeSession(admin: any, pharmacyId: string, bridgeSessionId: string, status: "active" | "inactive" | "expired" | "failed") {
  const update: Record<string, string> = {
    status,
    updated_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
  };
  const { error } = await admin
    .from("phif_bridge_sessions")
    .update(update)
    .eq("pharmacy_id", pharmacyId)
    .eq("bridge_session_id", bridgeSessionId);
  if (error) throw new Error(error.message);
}

async function currentBridgeSession(admin: any, pharmacyId: string): Promise<BridgeSessionRecord | null> {
  const now = new Date().toISOString();
  await admin
    .from("phif_bridge_sessions")
    .update({ status: "expired", updated_at: now, last_checked_at: now })
    .eq("pharmacy_id", pharmacyId)
    .eq("status", "active")
    .lte("expires_at", now);

  const { data, error } = await admin
    .from("phif_bridge_sessions")
    .select("bridge_session_id, pharmacy_id, expires_at")
    .eq("pharmacy_id", pharmacyId)
    .eq("status", "active")
    .gt("expires_at", now)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row?.bridge_session_id || !row?.expires_at) return null;
  return {
    bridge_session_id: row.bridge_session_id,
    pharmacy_id: row.pharmacy_id,
    login_url: null,
    expires_at: row.expires_at,
  };
}

async function getOrCreateBridgeSession(admin: any, pharmacyId: string): Promise<BridgeSessionRecord> {
  const current = await currentBridgeSession(admin, pharmacyId);
  if (isSessionFresh(current)) {
    try {
      const verified = await bridgeJson(`/api/bridge-sessions/${encodeURIComponent(current!.bridge_session_id)}/login-url`, {
        pharmacyId,
      });
      return { ...current!, login_url: verified.login_url ?? current!.login_url };
    } catch {
      await markBridgeSession(admin, pharmacyId, current!.bridge_session_id, "expired");
    }
  }
  return await storeBridgeSession(admin, pharmacyId, await createBridgeSession(pharmacyId));
}

function normalizeBridgeInvoice(
  invoiceKey: string,
  payload: any,
): Omit<PhifInvoicePreview, "patient_match" | "patient_id"> {
  const invoice = payload?.invoice ?? payload;
  if (invoice?.items && ("card_number" in invoice || "financial_fields" in (invoice.items[0] ?? {}))) {
    return {
      invoice_key: invoiceKey,
      invoice_number: invoice.invoice_number ?? null,
      insurance_card_number: normalizePhifCard(invoice.card_number ?? invoice.insurance_card_number),
      beneficiary_name: invoice.beneficiary_name ?? null,
      dispensing_date: invoice.dispensing_date ?? null,
      dispensing_time: invoice.dispensing_time ?? null,
      status: invoice.status ?? null,
      metadata: {},
      items: (invoice.items ?? []).map((item: any) => ({
        phif_item_id: item.phif_item_id ?? null,
        active_ingredient: item.active_ingredient ?? null,
        strength: item.strength ?? null,
        brand: item.brand ?? null,
        quantity: typeof item.quantity === "number" ? item.quantity : pickNumber(item, ["quantity"]),
        supplier: item.supplier ?? null,
        source_classification: item.source_classification ?? classifyPhifItemSource(item),
        phif_financial_fields: item.phif_financial_fields ?? item.financial_fields ?? {},
        metadata: item.metadata ?? {},
      })),
    };
  }
  return parsePhifTransactionDetail(invoiceKey, payload);
}

function normalizeBridgeTransactions(payload: any): PhifTransactionSummary[] {
  if (Array.isArray(payload?.rows)) {
    return payload.rows
      .map((row: any) => {
        const invoiceKey = pickString(row, ["invoice_key", "invoiceKey"]);
        if (!invoiceKey) return null;
        return {
          invoice_key: invoiceKey,
          invoice_id: pickString(row, ["invoice_number", "invoice_id", "invoiceId"]),
          beneficiary_code: pickString(row, ["card_number", "beneficiary_code", "beneficiaryCode"]),
          beneficiary_name: pickString(row, ["beneficiary_name", "beneficiaryName"]),
          status: pickString(row, ["status"]),
          action: null,
        };
      })
      .filter(Boolean) as PhifTransactionSummary[];
  }
  return parsePhifTodayTransactions(payload);
}

async function findAccessiblePatientByCard(admin: any, pharmacyId: string, card: string | null) {
  if (!card) return null;
  const { data: patient, error } = await admin
    .from("patients")
    .select("id")
    .eq("insurance_card_number", card)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!patient?.id) return null;

  const { count: mine } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patient.id)
    .eq("pharmacy_id", pharmacyId);
  if ((mine ?? 0) > 0) return patient.id as string;

  const { count: any } = await admin
    .from("dispensing_transactions")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patient.id);
  return (any ?? 0) === 0 ? (patient.id as string) : null;
}

export const getPhifSessionStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { pharmacy_id } = await requirePharmacySession();
  const db = supabaseAdmin as any;
  if (!bridgeSecret()) {
    return {
      configured: false,
      authenticated: false,
      login_url: null,
      expires_at: null,
      message: "PHIF bridge is not configured",
    } satisfies PhifSessionStatusResult;
  }

  const session = await currentBridgeSession(db, pharmacy_id);
  if (!session) {
    return {
      configured: true,
      authenticated: false,
      login_url: null,
      expires_at: null,
      message: "PHIF bridge session is not created yet",
    } satisfies PhifSessionStatusResult;
  }

  try {
    const status = await bridgeJson(`/api/bridge-sessions/${encodeURIComponent(session.bridge_session_id)}/status`, {
      pharmacyId: pharmacy_id,
    });
    await markBridgeSession(db, pharmacy_id, session.bridge_session_id, "active");
    return {
      configured: true,
      authenticated: Boolean(status.authenticated),
      login_url: session.login_url,
      expires_at: session.expires_at,
      message: status.authenticated ? "PHIF session is available" : "PHIF login is required",
    } satisfies PhifSessionStatusResult;
  } catch (error: any) {
    const message = error?.message ?? "PHIF session check failed";
    if (message.includes("not found") || message.includes("expired")) {
      await markBridgeSession(db, pharmacy_id, session.bridge_session_id, "expired");
    }
    return {
      configured: true,
      authenticated: false,
      login_url: session.login_url,
      expires_at: session.expires_at,
      message,
    } satisfies PhifSessionStatusResult;
  }
});

export const createPhifLoginSession = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { pharmacy_id } = await requirePharmacySession();
  const db = supabaseAdmin as any;
  if (!bridgeSecret()) throw new Error("PHIF bridge secret is not configured");
  const session = await getOrCreateBridgeSession(db, pharmacy_id);
  return {
    ok: true as const,
    login_url: session.login_url,
    expires_at: session.expires_at,
  };
});

export const inspectPhifTransactions = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
  const { pharmacy_id } = await requirePharmacySession();
  const db = supabaseAdmin as any;
  const session = await currentBridgeSession(db, pharmacy_id);
  if (!session) throw new Error("PHIF login is required before checking transactions");

  let todayPayload: any;
  try {
    todayPayload = await bridgeJson(`/api/bridge-sessions/${encodeURIComponent(session.bridge_session_id)}/today-transactions`, {
      pharmacyId: pharmacy_id,
    });
  } catch (error: any) {
    const message = error?.message ?? "";
    if (message.includes("not found") || message.includes("expired")) {
      await markBridgeSession(db, pharmacy_id, session.bridge_session_id, "expired");
    }
    throw error;
  }
  const transactions = normalizeBridgeTransactions(todayPayload);
  const emptyDayServerResponse = todayPayload?.metadata?.empty_day_server_response === true;
  const preview: PhifInvoicePreview[] = [];
  let duplicate_count = 0;
  let failed_count = 0;

  for (const tx of transactions) {
    const { data: existing } = await db
      .from("phif_invoices")
      .select("id")
      .eq("pharmacy_id", pharmacy_id)
      .eq("invoice_key", tx.invoice_key)
      .maybeSingle();
    if (existing) {
      duplicate_count++;
      continue;
    }

    try {
      const detail = normalizeBridgeInvoice(
        tx.invoice_key,
        await bridgeJson(
          `/api/bridge-sessions/${encodeURIComponent(session.bridge_session_id)}/invoices/${encodeURIComponent(tx.invoice_key)}`,
          { pharmacyId: pharmacy_id },
        ),
      );
      const patient_id = await findAccessiblePatientByCard(db, pharmacy_id, detail.insurance_card_number);
      preview.push({
        ...detail,
        status: detail.status ?? tx.status,
        beneficiary_name: detail.beneficiary_name ?? tx.beneficiary_name,
        insurance_card_number: detail.insurance_card_number ?? normalizePhifCard(tx.beneficiary_code),
        patient_match: patient_id ? "matched" : "not_matched",
        patient_id,
      });
    } catch {
      failed_count++;
    }
  }

  return {
    ok: true as const,
    summary: {
      total: transactions.length,
      new_count: preview.length,
      duplicate_count,
      failed_count,
      needs_review_count: preview.filter((p) => p.patient_match === "not_matched").length,
    },
    preview,
    metadata: {
      empty_day_server_response: emptyDayServerResponse,
    },
  };
});

const invoiceItemSchema = z.object({
  phif_item_id: z.string().nullable(),
  active_ingredient: z.string().nullable(),
  strength: z.string().nullable(),
  brand: z.string().nullable(),
  quantity: z.number().nullable(),
  supplier: z.string().nullable(),
  source_classification: z.string().nullable(),
  phif_financial_fields: z.record(z.unknown()),
  metadata: z.record(z.unknown()),
});

const saveSchema = z.object({
  invoices: z.array(
    z.object({
      invoice_key: z.string().min(1),
      invoice_number: z.string().nullable(),
      insurance_card_number: z.string().nullable(),
      beneficiary_name: z.string().nullable(),
      dispensing_date: z.string().nullable(),
      dispensing_time: z.string().nullable(),
      status: z.string().nullable(),
      metadata: z.record(z.unknown()),
      items: z.array(invoiceItemSchema),
    }),
  ).max(200),
});

export const saveNewPhifInvoices = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { requirePharmacySession } = await import("@/lib/pharmacy-session.server");
    const { pharmacy_id } = await requirePharmacySession();
    const db = supabaseAdmin as any;

    const { data: run, error: runError } = await db
      .from("phif_sync_runs")
      .insert({
        pharmacy_id,
        status: "pending",
      })
      .select("id")
      .single();
    if (runError || !run) throw new Error(runError?.message ?? "Failed to create PHIF sync run");

    let new_count = 0;
    let duplicate_count = 0;
    let failed_count = 0;

    for (const invoice of data.invoices) {
      const { data: existing } = await db
        .from("phif_invoices")
        .select("id")
        .eq("pharmacy_id", pharmacy_id)
        .eq("invoice_key", invoice.invoice_key)
        .maybeSingle();
      if (existing) {
        duplicate_count++;
        continue;
      }

      const { data: inserted, error } = await db
        .from("phif_invoices")
        .insert({
          pharmacy_id,
          sync_run_id: run.id,
          invoice_key: invoice.invoice_key,
          invoice_number: invoice.invoice_number,
          insurance_card_number: normalizePhifCard(invoice.insurance_card_number),
          beneficiary_name: invoice.beneficiary_name,
          dispensing_date: invoice.dispensing_date,
          dispensing_time: invoice.dispensing_time,
          status: invoice.status,
          metadata: invoice.metadata,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        failed_count++;
        continue;
      }

      if (invoice.items.length > 0) {
        const { error: itemError } = await db.from("phif_invoice_items").insert(
          invoice.items.map((item) => ({
            phif_invoice_id: inserted.id,
            phif_item_id: item.phif_item_id,
            active_ingredient: item.active_ingredient,
            strength: item.strength,
            brand: item.brand,
            quantity: item.quantity,
            supplier: item.supplier,
            source_classification: item.source_classification,
            phif_financial_fields: item.phif_financial_fields,
            metadata: item.metadata,
          })),
        );
        if (itemError) failed_count++;
      }
      new_count++;
    }

    await db
      .from("phif_sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: failed_count > 0 ? "failed" : "completed",
        new_count,
        duplicate_count,
        failed_count,
      })
      .eq("id", run.id);

    return { ok: true as const, run_id: run.id as string, new_count, duplicate_count, failed_count };
  });
