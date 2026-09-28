import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { PhifClient } from "./phif/client.js";
import { parseFilterTransactionForm, parseHistoricalTransactions, parseInvoiceDetails, parseTodayTransactions } from "./phif/parsers.js";
import { getPhifSessionStatus, phifSessionFetch, proxyPhifLoginRequest } from "./phif/sessionBridge.js";
import { BridgeSessionStore, publicSession } from "./sessionStore.js";

const DEFAULT_PORT = 5174;

export function createPhifBridgeServer({
  secret = process.env.PHIF_BRIDGE_SECRET,
  store = new BridgeSessionStore(),
  fetchImpl = fetch,
  timeoutMs = Number(process.env.PHIF_BRIDGE_TIMEOUT_MS || 15000),
} = {}) {
  const server = createServer(async (req, res) => {
    try {
      setNoStore(res);
      const url = new URL(req.url || "/", requestOrigin(req));
      if (url.pathname.startsWith("/phif-login/")) {
        const sessionId = decodeURIComponent(url.pathname.split("/")[2] || "");
        const session = store.get(sessionId);
        if (!session) return json(res, 404, { ok: false, error: "Bridge session not found or expired" });
        await proxyPhifLoginRequest(req, res, url, session, { fetchImpl, timeoutMs });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, { secret, store, fetchImpl, timeoutMs });
        return;
      }
      json(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      json(res, 500, { ok: false, error: error?.message || "Unexpected bridge error" });
    }
  });

  return server;
}

async function handleApi(req, res, url, context) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return json(res, 200, { ok: true, service: "phif-local-bridge" });
  }

  if (req.method === "POST" && url.pathname === "/api/bridge-sessions") {
    if (!requireSecret(req, res, context.secret)) return;
    const body = await readJson(req);
    const session = context.store.create(body.pharmacy_id);
    return json(res, 201, {
      ok: true,
      session,
      login_url: `${publicOrigin(req)}/phif-login/${encodeURIComponent(session.bridge_session_id)}/login`,
    });
  }

  const sessionMatch = url.pathname.match(/^\/api\/bridge-sessions\/([^/]+)(?:\/(.+))?$/);
  if (!sessionMatch) return json(res, 404, { ok: false, error: "Not found" });
  if (!requireSecret(req, res, context.secret)) return;

  const sessionId = decodeURIComponent(sessionMatch[1]);
  const action = sessionMatch[2] || "";
  const pharmacyId = req.headers["x-pharmacy-id"] || url.searchParams.get("pharmacy_id");
  const session = context.store.get(sessionId, pharmacyId);
  if (!session) return json(res, 404, { ok: false, error: "Bridge session not found or not authorized" });

  if (req.method === "GET" && action === "login-url") {
    return json(res, 200, {
      ok: true,
      login_url: `${publicOrigin(req)}/phif-login/${encodeURIComponent(session.bridge_session_id)}/login`,
    });
  }

  if (req.method === "GET" && action === "login-complete") {
    return json(res, 200, { ok: true, message: "PHIF login flow completed. You can return to PHIF Tracker." });
  }

  if (req.method === "GET" && action === "status") {
    const status = await getPhifSessionStatus(session, context);
    return json(res, 200, { ok: true, session: publicSession(session), ...status });
  }

  if (req.method === "GET" && action === "today-transactions") {
    const client = new PhifClient({
      fetchImpl: (input, options) => phifSessionFetch(session, input, { ...options, ...context }),
      timeoutMs: context.timeoutMs,
    });
    const result = await client.getJson("/toDaysTransaction");
    if (!result.ok && isKnownEmptyTodayServerResponse(result)) {
      return json(res, 200, {
        ok: true,
        rows: [],
        raw_count: 0,
        metadata: { empty_day_server_response: true, upstream_status: result.status },
      });
    }
    if (!result.ok) return json(res, result.blocked ? 403 : 502, result);
    return json(res, 200, { ok: true, rows: parseTodayTransactions(result.json), raw_count: countRawRows(result.json) });
  }

  if (req.method === "GET" && action === "stock") {
    const client = new PhifClient({
      fetchImpl: (input, options) => phifSessionFetch(session, input, { ...options, ...context }),
      timeoutMs: context.timeoutMs,
    });
    const result = await fetchCompleteStock(client);
    if (!result.ok) return json(res, result.blocked ? 403 : 502, safeStockFailure(result));
    const sourceCheck = validateStockSourcePharmacy(result.rows);
    if (!sourceCheck.ok) return json(res, 502, safeStockFailure(sourceCheck));
    return json(res, 200, {
      ok: true,
      rows: result.rows,
      raw_count: result.rows.length,
      recordsTotal: result.recordsTotal,
      recordsFiltered: result.recordsFiltered,
      metadata: {
        source: "get-pharmacy-stock",
        request_method: "GET",
        pages: result.pages,
      },
    });
  }

  if (req.method === "POST" && action === "historical-transactions") {
    const body = await readJson(req);
    const dateFrom = normalizeDateInput(body.dateFrom);
    const dateTo = normalizeDateInput(body.dateTo);
    if (!dateFrom || !dateTo) return json(res, 400, { ok: false, error: "dateFrom and dateTo are required as YYYY-MM-DD" });
    if (Date.parse(dateFrom) > Date.parse(dateTo)) return json(res, 400, { ok: false, error: "dateFrom must be before or equal dateTo" });

    const client = new PhifClient({
      fetchImpl: (input, options) => phifSessionFetch(session, input, { ...options, ...context }),
      timeoutMs: context.timeoutMs,
    });
    const page = await client.getHtml("/showPharmacyFilterTransactions");
    if (!page.ok) return json(res, page.blocked ? 403 : 502, safeUpstreamFailure(page));

    const form = parseFilterTransactionForm(page.text);
    const postFields = {
      ...form.hidden_fields,
      dateFrom: formatPhifFilterDate(dateFrom, form, "dateFrom"),
      dateTo: formatPhifFilterDate(dateTo, form, "dateTo"),
    };
    const result = await client.postForm("/showPharmacyFilterTransactions", postFields);
    if (!result.ok) return json(res, result.blocked ? 403 : 502, safeUpstreamFailure(result));

    const posResult = await client.getJson("/PosTransaction");
    if (!posResult.ok) return json(res, posResult.blocked ? 403 : 502, safeUpstreamFailure(posResult));
    const rows = parseTodayTransactions(posResult.json);
    return json(res, 200, {
      ok: true,
      rows,
      raw_count: rows.length,
      metadata: {
        source: "PosTransaction",
        request_method: "POST",
        request_path: "/showPharmacyFilterTransactions",
        request_fields: Object.keys(postFields).map((name) => ({
          name,
          sensitive: /token|csrf|_token/i.test(name),
        })),
        dateFrom,
        dateTo,
        upstream_status: posResult.status,
        response_content_type: posResult.contentType ?? null,
        response_body_type: "json",
        final_path: result.finalPath ?? "/showPharmacyFilterTransactions",
        form: {
          action: form.action,
          method: form.method,
          controls: form.controls.map((control) => ({
            ...control,
            value: /token|csrf|_token/i.test(control.name ?? "") ? "[redacted]" : control.value,
          })),
        },
      },
    });
  }

  const invoiceMatch = action.match(/^invoices\/([^/]+)$/);
  if (req.method === "GET" && invoiceMatch) {
    const invoiceKey = decodeURIComponent(invoiceMatch[1]);
    const client = new PhifClient({
      fetchImpl: (input, options) => phifSessionFetch(session, input, { ...options, ...context }),
      timeoutMs: context.timeoutMs,
    });
    const result = await client.getHtml(`/getTransaction/${encodeURIComponent(invoiceKey)}`);
    if (!result.ok) return json(res, result.blocked ? 403 : 502, result);
    return json(res, 200, { ok: true, invoice: parseInvoiceDetails(result.text, invoiceKey) });
  }

  if (req.method === "DELETE" && action === "") {
    context.store.clear(sessionId, pharmacyId);
    return json(res, 200, { ok: true, cleared: true });
  }

  json(res, 404, { ok: false, error: "Not found" });
}

function requireSecret(req, res, secret) {
  if (!secret) {
    json(res, 500, { ok: false, error: "PHIF_BRIDGE_SECRET is required" });
    return false;
  }
  if (req.headers["x-phif-bridge-secret"] !== secret) {
    json(res, 401, { ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function countRawRows(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  return 0;
}

async function fetchCompleteStock(client) {
  const first = await client.getJson("/get-pharmacy-stock");
  if (!first.ok) return first;
  const firstRows = Array.isArray(first.json?.data) ? first.json.data : [];
  const total = Number(first.json?.recordsTotal ?? first.json?.recordsFiltered ?? firstRows.length);
  const rows = [];
  const seen = new Set();
  addUniqueStockRows(rows, seen, firstRows);
  if (!Number.isFinite(total) || total <= firstRows.length || firstRows.length === 0) {
    if (Number.isFinite(total) && rows.length < total) {
      return incompleteStockPaginationFailure();
    }
    return {
      ok: true,
      rows,
      recordsTotal: Number.isFinite(total) ? total : firstRows.length,
      recordsFiltered: Number(first.json?.recordsFiltered ?? firstRows.length),
      pages: 1,
    };
  }

  const length = Math.max(firstRows.length, 100);
  let pages = 1;
  for (let start = firstRows.length; start < total; start += length) {
    const page = await client.getJson(`/get-pharmacy-stock?start=${start}&length=${length}`);
    if (!page.ok) return page;
    const pageRows = Array.isArray(page.json?.data) ? page.json.data : [];
    const added = addUniqueStockRows(rows, seen, pageRows);
    pages++;
    if (pageRows.length === 0 || added === 0) break;
  }

  if (rows.length < total) {
    return incompleteStockPaginationFailure();
  }

  return {
    ok: true,
    rows,
    recordsTotal: total,
    recordsFiltered: Number(first.json?.recordsFiltered ?? total),
    pages,
  };
}

function incompleteStockPaginationFailure() {
  return {
    ok: false,
    status: 502,
    contentType: "application/json",
    message: "PHIF stock pagination did not return all records",
  };
}

function validateStockSourcePharmacy(rows) {
  const expected = process.env.PHIF_TIRYAQ_SOURCE_PHARMACY_ID?.trim();
  if (!expected) {
    return {
      ok: false,
      status: 500,
      contentType: "application/json",
      message: "PHIF_TIRYAQ_SOURCE_PHARMACY_ID is not configured in PHIF Bridge",
    };
  }
  let missing = 0;
  let mismatched = 0;
  for (const row of rows) {
    const source = stockSourcePharmacyId(row);
    if (!source) missing++;
    else if (source !== expected) mismatched++;
  }
  if (missing > 0) {
    return {
      ok: false,
      status: 502,
      contentType: "application/json",
      message: "PHIF stock response contains rows without source pharmacy identity",
    };
  }
  if (mismatched > 0) {
    return {
      ok: false,
      status: 502,
      contentType: "application/json",
      message: "PHIF stock response source pharmacy does not match Tiryaq",
    };
  }
  return { ok: true };
}

function stockSourcePharmacyId(row) {
  const raw = row?.pharmacies_id ?? row?.pharmacy_id ?? row?.source_pharmacy_id;
  if (raw === undefined || raw === null) return null;
  const value = String(raw).trim();
  return value || null;
}

function addUniqueStockRows(target, seen, rows) {
  let added = 0;
  for (const row of rows) {
    const key = stockRowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(row);
    added++;
  }
  return added;
}

function stockRowKey(row) {
  const id = row?.id ?? row?.stock_id ?? row?.stockId;
  if (id !== undefined && id !== null && String(id).trim()) return `id:${String(id).trim()}`;
  return `row:${JSON.stringify(row)}`;
}

function normalizeDateInput(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function formatPhifFilterDate(isoDate, form, fieldName) {
  const control = form?.controls?.find((item) => item.name === fieldName);
  const hint = `${control?.value ?? ""} ${control?.placeholder ?? ""} ${control?.type ?? ""}`;
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate) ?? [];
  if (!year) return isoDate;
  if (String(control?.type ?? "").toLowerCase() === "date") {
    return isoDate;
  }
  if (/\bdd[/-]mm[/-]yyyy\b|\bd\/m\/y\b|\d{2}\/\d{2}\/\d{4}/i.test(hint)) {
    return `${day}/${month}/${year}`;
  }
  if (/\bmm[/-]dd[/-]yyyy\b|\d{2}-\d{2}-\d{4}/i.test(hint)) {
    return `${month}/${day}/${year}`;
  }
  return isoDate;
}

function looksJson(result) {
  const contentType = String(result?.contentType ?? "").toLowerCase();
  if (contentType.includes("json")) return true;
  const text = String(result?.text ?? "").trim();
  return text.startsWith("{") || text.startsWith("[");
}

function safeUpstreamFailure(result) {
  return {
    ok: false,
    error: "PHIF historical request failed",
    diagnostic: {
      status: result?.status ?? null,
      contentType: result?.contentType ?? null,
      authRequired: result?.authRequired === true,
      classification: classifyUpstreamBody(result),
      redirect: result?.location ? classifyRedirect(result.location) : null,
      message: result?.message ?? null,
    },
  };
}

function safeStockFailure(result) {
  return {
    ok: false,
    error: "PHIF stock request failed",
    diagnostic: {
      status: result?.status ?? null,
      contentType: result?.contentType ?? null,
      authRequired: result?.authRequired === true,
      classification: classifyUpstreamBody(result),
      message: result?.message ?? null,
    },
  };
}

function classifyUpstreamBody(result) {
  const text = String(result?.text ?? "");
  const compact = text.replace(/\s+/g, " ").slice(0, 1000);
  if (result?.authRequired || looksLikeLoginBody(text)) return "login_page";
  if (/<title[^>]*>\s*PHIF-500\s*<\/title>/i.test(text) || /Server Error|error|exception/i.test(compact)) return "phif_error_page";
  if (/<table\b/i.test(text) || /data-inv_id|data-inv-id|getTransaction/i.test(text)) return "html_results";
  if (looksJson(result)) return "json";
  if (/<html\b/i.test(text)) return "html";
  if (!text.trim()) return "empty";
  return "text";
}

function looksLikeLoginBody(text) {
  return /<form[^>]+action=["'][^"']*\/login["']/i.test(text)
    || /<input[^>]+name=["']password["']/i.test(text);
}

function classifyRedirect(location) {
  try {
    const path = new URL(location, "https://his.phif.gov.ly").pathname;
    if (path === "/login") return "login";
    return "other";
  } catch {
    return "invalid";
  }
}

function isKnownEmptyTodayServerResponse(result) {
  if (result?.status !== 500 || result?.authRequired || result?.blocked) return false;
  const text = String(result?.text ?? "").trim();
  const compact = text.replace(/\s+/g, " ");
  return /^"?\{?\s*"message"\s*:\s*"Server Error"\s*\}?"?$/i.test(text)
    || (/<title[^>]*>\s*PHIF-500\s*<\/title>/i.test(text) && /Server Error/i.test(compact));
}

function requestOrigin(req) {
  return `http://${req.headers.host || `127.0.0.1:${DEFAULT_PORT}`}`;
}

function publicOrigin(req) {
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || "http";
  const host = firstHeader(req.headers["x-forwarded-host"]) || req.headers.host || `127.0.0.1:${DEFAULT_PORT}`;
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host)) return requestOrigin(req);
  return `${proto === "https" ? "https" : "http"}://${host}`;
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const host = process.env.HOST || "127.0.0.1";
  const server = createPhifBridgeServer();
  server.listen(port, host, () => {
    console.log(`PHIF local bridge running at http://${host}:${port}`);
  });
}
