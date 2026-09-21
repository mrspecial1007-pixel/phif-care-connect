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
    if (!page.ok) return json(res, page.blocked ? 403 : 502, page);

    const form = parseFilterTransactionForm(page.text);
    const postFields = {
      ...form.hidden_fields,
      dateFrom,
      dateTo,
    };
    const result = await client.postForm("/showPharmacyFilterTransactions", postFields);
    if (!result.ok) return json(res, result.blocked ? 403 : 502, result);

    const rows = parseHistoricalTransactions(result.text);
    return json(res, 200, {
      ok: true,
      rows,
      raw_count: rows.length,
      metadata: {
        source: "showPharmacyFilterTransactions",
        request_method: "POST",
        request_path: "/showPharmacyFilterTransactions",
        request_fields: Object.keys(postFields).map((name) => ({
          name,
          sensitive: /token|csrf|_token/i.test(name),
        })),
        dateFrom,
        dateTo,
        upstream_status: result.status,
        response_content_type: result.contentType ?? null,
        response_body_type: looksJson(result) ? "json" : "html",
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

function normalizeDateInput(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : text;
}

function looksJson(result) {
  const contentType = String(result?.contentType ?? "").toLowerCase();
  if (contentType.includes("json")) return true;
  const text = String(result?.text ?? "").trim();
  return text.startsWith("{") || text.startsWith("[");
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
