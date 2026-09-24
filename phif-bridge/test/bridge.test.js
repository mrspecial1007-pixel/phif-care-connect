import test from "node:test";
import assert from "node:assert/strict";
import { BridgeSessionStore, publicSession } from "../sessionStore.js";
import { isAllowedPostFormPath, isAllowedReadPath, PhifClient } from "../phif/client.js";
import { forwardHeaders, isAllowedProxyGet, isAllowedProxyRequest, proxyPhifLoginRequest, rewriteHtml, toLocalProxyLocation } from "../phif/sessionBridge.js";
import { parseFilterTransactionForm, parseHistoricalTransactions, parseTodayTransactions } from "../phif/parsers.js";
import { createPhifBridgeServer } from "../server.js";

const SECRET = "test-secret";

test("session store isolates PHIF cookies by pharmacy", () => {
  const store = new BridgeSessionStore();
  const a = store.create("pharmacy-a");
  const b = store.create("pharmacy-b");
  const sessionA = store.get(a.bridge_session_id, "pharmacy-a");
  const sessionB = store.get(b.bridge_session_id, "pharmacy-b");
  sessionA.cookieJar.set("phif_session", "a-cookie");
  sessionB.cookieJar.set("phif_session", "b-cookie");

  assert.equal(store.get(a.bridge_session_id, "pharmacy-b"), null);
  assert.equal(store.get(a.bridge_session_id, "pharmacy-a").cookieJar.get("phif_session"), "a-cookie");
  assert.equal(store.get(b.bridge_session_id, "pharmacy-b").cookieJar.get("phif_session"), "b-cookie");
});

test("public session data never includes cookies", () => {
  const store = new BridgeSessionStore();
  const created = store.create("pharmacy-a");
  const session = store.get(created.bridge_session_id, "pharmacy-a");
  session.cookieJar.set("phif_session", "secret-cookie");

  assert.equal(JSON.stringify(publicSession(session)).includes("secret-cookie"), false);
  assert.equal("cookieJar" in publicSession(session), false);
});

test("session expiry and clear remove access", () => {
  let now = 1000;
  const store = new BridgeSessionStore({ ttlMs: 100, now: () => now });
  const created = store.create("pharmacy-a");
  assert.ok(store.get(created.bridge_session_id, "pharmacy-a"));
  now = 1101;
  assert.equal(store.get(created.bridge_session_id, "pharmacy-a"), null);

  const second = store.create("pharmacy-a");
  assert.equal(store.clear(second.bridge_session_id, "pharmacy-a"), true);
  assert.equal(store.get(second.bridge_session_id, "pharmacy-a"), null);
});

test("read allowlist permits only phase-one read endpoints", () => {
  assert.equal(isAllowedReadPath("/toDaysTransaction"), true);
  assert.equal(isAllowedReadPath("/showPharmacyFilterTransactions"), true);
  assert.equal(isAllowedReadPath("/pharmacyFilteredtransactions"), true);
  assert.equal(isAllowedReadPath("/PosTransaction"), true);
  assert.equal(isAllowedReadPath("/getTransaction/2026-4197020-2857276"), true);

  assert.equal(isAllowedReadPath("/cashing"), false);
  assert.equal(isAllowedReadPath("/PosTransaction/anything"), false);
  assert.equal(isAllowedReadPath("/showPharmacyFilterTransactions/anything"), false);
  assert.equal(isAllowedReadPath("/cancelTransaction/1"), false);
  assert.equal(isAllowedReadPath("/orders/receive/1"), false);
  assert.equal(isAllowedReadPath("/permissionDispenseMedication"), false);
  assert.equal(isAllowedReadPath("https://his.phif.gov.ly/toDaysTransaction"), false);
});

test("POST allowlist is limited to the historical filter form", () => {
  assert.equal(isAllowedPostFormPath("/showPharmacyFilterTransactions"), true);
  assert.equal(isAllowedPostFormPath("/showPharmacyFilterTransactions/extra"), false);
  assert.equal(isAllowedPostFormPath("/toDaysTransaction"), false);
  assert.equal(isAllowedPostFormPath("/cashing"), false);
});

test("client blocks unsafe paths before network access", async () => {
  let called = false;
  const client = new PhifClient({
    fetchImpl: async () => {
      called = true;
      throw new Error("fetch should not be called");
    },
  });

  const result = await client.getHtml("/cashing");
  assert.equal(result.blocked, true);
  assert.equal(called, false);
});

test("proxy allows login, captcha, assets, and read-only GET paths only", () => {
  assert.equal(isAllowedProxyGet("/captcha/default"), true);
  assert.equal(isAllowedProxyGet("/login"), true);
  assert.equal(isAllowedProxyGet("/build/app.css"), true);
  assert.equal(isAllowedProxyGet("/toDaysTransaction"), true);
  assert.equal(isAllowedProxyGet("/showPharmacyFilterTransactions"), true);
  assert.equal(isAllowedProxyRequest("POST", "/login"), true);

  assert.equal(isAllowedProxyRequest("POST", "/cashing"), false);
  assert.equal(isAllowedProxyRequest("POST", "/showPharmacyFilterTransactions"), false);
  assert.equal(isAllowedProxyRequest("POST", "/cancelTransaction/1"), false);
  assert.equal(isAllowedProxyRequest("PUT", "/login"), false);
});

test("redirect and HTML rewriting keep browser inside the bridge", () => {
  const sessionId = "session-123";
  const rewritten = rewriteHtml(
    '<form action="/login"><img src="/captcha/default?abc"><a href="https://his.phif.gov.ly/home">home</a>',
    sessionId,
  );

  assert.match(rewritten, /action="\/phif-login\/session-123\/login"/);
  assert.match(rewritten, /src="\/phif-login\/session-123\/captcha\/default\?abc"/);
  assert.match(rewritten, /href="\/phif-login\/session-123\/home"/);
  assert.equal(toLocalProxyLocation("http://his.phif.gov.ly/login", sessionId), "/phif-login/session-123/login");
});

test("auth POST forwarding strips local cookies and sets PHIF origin/referer", () => {
  const headers = forwardHeaders({
    host: "127.0.0.1:5174",
    origin: "http://127.0.0.1:5174",
    referer: "http://127.0.0.1:5174/phif-login/session/login",
    cookie: "local-cookie=hidden",
    "content-type": "application/x-www-form-urlencoded",
    "sec-fetch-site": "same-origin",
  }, new URL("https://his.phif.gov.ly/login"));

  assert.equal(headers.get("origin"), "https://his.phif.gov.ly");
  assert.equal(headers.get("referer"), "https://his.phif.gov.ly/login");
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("sec-fetch-site"), null);
});

test("successful PHIF home load renders browser-safe success page without API secret", async () => {
  const req = { method: "GET", headers: {} };
  const res = captureResponse();
  const session = {
    bridge_session_id: "session-123",
    pharmacy_id: "pharmacy-a",
    cookieJar: new Map(),
  };

  await proxyPhifLoginRequest(req, res, new URL("http://127.0.0.1/phif-login/session-123/home"), session, {
    fetchImpl: async () => new Response("<html>home</html>", { status: 200, headers: { "content-type": "text/html" } }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.Location, undefined);
  assert.match(res.body, /تم تسجيل الدخول إلى PHIF بنجاح/);
  assert.doesNotMatch(res.body, /PHIF_BRIDGE_SECRET|session-123|pharmacy-a|cookie/i);
});

test("API requires bridge secret and matching pharmacy", async () => {
  const server = createPhifBridgeServer({ secret: SECRET });
  await using app = await listen(server);

  const unauthorized = await fetch(`${app.url}/api/bridge-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pharmacy_id: "pharmacy-a" }),
  });
  assert.equal(unauthorized.status, 401);

  const created = await fetchJson(`${app.url}/api/bridge-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-phif-bridge-secret": SECRET },
    body: JSON.stringify({ pharmacy_id: "pharmacy-a" }),
  });
  assert.equal(created.status, 201);
  assert.match(created.body.login_url, /\/phif-login\/.+\/login$/);

  const wrongPharmacy = await fetch(`${app.url}/api/bridge-sessions/${created.body.session.bridge_session_id}/status`, {
    headers: { "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-b" },
  });
  assert.equal(wrongPharmacy.status, 404);
});

test("known PHIF empty-day server response returns zero today transactions", async () => {
  const store = new BridgeSessionStore();
  const session = store.create("pharmacy-a");
  const server = createPhifBridgeServer({
    secret: SECRET,
    store,
    fetchImpl: async () => new Response('{\n "message": "Server Error"\n}', {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
  });
  await using app = await listen(server);

  const result = await fetchJson(`${app.url}/api/bridge-sessions/${session.bridge_session_id}/today-transactions`, {
    headers: { "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-a" },
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body.rows, []);
  assert.equal(result.body.raw_count, 0);
  assert.equal(result.body.metadata.empty_day_server_response, true);
});

test("different PHIF 500 remains an upstream error", async () => {
  const store = new BridgeSessionStore();
  const session = store.create("pharmacy-a");
  const server = createPhifBridgeServer({
    secret: SECRET,
    store,
    fetchImpl: async () => new Response("Database unavailable", {
      status: 500,
      headers: { "content-type": "text/plain" },
    }),
  });
  await using app = await listen(server);

  const response = await fetch(`${app.url}/api/bridge-sessions/${session.bridge_session_id}/today-transactions`, {
    headers: { "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-a" },
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.status, 500);
  assert.equal(body.text, "Database unavailable");
});

test("historical transaction endpoint posts only dateFrom/dateTo plus hidden form fields", async () => {
  const store = new BridgeSessionStore();
  const session = store.create("pharmacy-a");
  const calls = [];
  const server = createPhifBridgeServer({
    secret: SECRET,
    store,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push({
        path: url.pathname,
        method: options.method,
        body: options.body?.toString?.() ?? "",
        origin: new Headers(options.headers).get("origin"),
        referer: new Headers(options.headers).get("referer"),
      });
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "GET") {
        return new Response(`
          <form method="POST" action="/showPharmacyFilterTransactions">
            <input type="hidden" name="_token" value="secret-token">
            <input type="date" name="dateFrom">
            <input type="date" name="dateTo">
          </form>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "POST") {
        return new Response("<html><table id=\"datatable1\"><tbody></tbody></table></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/PosTransaction" && options.method === "GET") {
        return Response.json({
          data: [{
            invoiceId: "4197020",
            beneficiaryCode: "0061500147011",
            beneficiaryName: "Patient",
            status: "confirmed",
            action: '<button data-inv_id="2026-4197020-2857276">view</button>',
          }],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  await using app = await listen(server);

  const result = await fetchJson(`${app.url}/api/bridge-sessions/${session.bridge_session_id}/historical-transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-a" },
    body: JSON.stringify({ dateFrom: "2026-09-01", dateTo: "2026-09-02" }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.rows[0].invoice_key, "2026-4197020-2857276");
  assert.equal(result.body.rows[0].card_number, "0061500147011");
  assert.deepEqual(calls.map((call) => `${call.method} ${call.path}`), [
    "GET /showPharmacyFilterTransactions",
    "POST /showPharmacyFilterTransactions",
    "GET /PosTransaction",
  ]);
  assert.match(calls[1].body, /dateFrom=2026-09-01/);
  assert.match(calls[1].body, /dateTo=2026-09-02/);
  assert.equal(calls[1].origin, "https://his.phif.gov.ly");
  assert.equal(calls[1].referer, "https://his.phif.gov.ly/showPharmacyFilterTransactions");
  assert.doesNotMatch(JSON.stringify(result.body), /secret-token/);
});

test("filter transaction form parser selects the date form after the logout form", () => {
  const form = parseFilterTransactionForm(`
    <form method="POST" action="/logout">
      <input type="hidden" name="_token" value="logout-token">
    </form>
    <form method="POST" action="">
      <input type="hidden" name="_token" value="filter-token">
      <input type="date" name="dateFrom">
      <input type="date" name="dateTo">
      <button type="submit">search</button>
    </form>
  `);

  assert.equal(form.method, "POST");
  assert.equal(form.hidden_fields._token, "filter-token");
  assert.ok(form.controls.some((control) => control.name === "dateFrom" && control.type === "date"));
  assert.ok(form.controls.some((control) => control.name === "dateTo" && control.type === "date"));
});

test("historical transaction endpoint follows PHIF result redirect safely", async () => {
  const store = new BridgeSessionStore();
  const session = store.create("pharmacy-a");
  const calls = [];
  const server = createPhifBridgeServer({
    secret: SECRET,
    store,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      calls.push(`${options.method} ${url.pathname}`);
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "GET") {
        return new Response(`
          <form method="POST" action="">
            <input type="hidden" name="_token" value="secret-token">
            <input type="date" name="dateFrom">
            <input type="date" name="dateTo">
          </form>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { location: "/pharmacyFilteredtransactions" },
        });
      }
      if (url.pathname === "/pharmacyFilteredtransactions" && options.method === "GET") {
        return new Response(`
          <table id="datatable1"><tbody></tbody></table>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/PosTransaction" && options.method === "GET") {
        return Response.json({
          data: [{
            invoiceId: "4197020",
            beneficiaryCode: "0061500147011",
            beneficiaryName: "Patient",
            status: "confirmed",
            action: '<a href="/getTransaction/2026-4197020-2857276">view</a>',
          }],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  await using app = await listen(server);

  const result = await fetchJson(`${app.url}/api/bridge-sessions/${session.bridge_session_id}/historical-transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-a" },
    body: JSON.stringify({ dateFrom: "2026-09-20", dateTo: "2026-09-20" }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.rows[0].invoice_key, "2026-4197020-2857276");
  assert.equal(result.body.metadata.final_path, "/pharmacyFilteredtransactions");
  assert.deepEqual(calls, [
    "GET /showPharmacyFilterTransactions",
    "POST /showPharmacyFilterTransactions",
    "GET /pharmacyFilteredtransactions",
    "GET /PosTransaction",
  ]);
});

test("historical transaction endpoint follows PHIF http-to-https result redirect chain", async () => {
  const store = new BridgeSessionStore();
  const session = store.create("pharmacy-a");
  const redirectedUrls = [];
  const server = createPhifBridgeServer({
    secret: SECRET,
    store,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "GET") {
        return new Response(`
          <form method="POST" action="">
            <input type="hidden" name="_token" value="secret-token">
            <input type="date" name="dateFrom">
            <input type="date" name="dateTo">
          </form>
        `, { status: 200, headers: { "content-type": "text/html" } });
      }
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "POST") {
        return new Response("", {
          status: 302,
          headers: { location: "http://his.phif.gov.ly/pharmacyFilteredtransactions" },
        });
      }
      if (url.pathname === "/pharmacyFilteredtransactions" && options.method === "GET") {
        redirectedUrls.push(url.href);
        if (url.protocol === "http:") {
          return new Response("", {
            status: 301,
            headers: { location: "https://his.phif.gov.ly:443/pharmacyFilteredtransactions" },
          });
        }
        return new Response('<table id="datatable1"><tbody></tbody></table>', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.pathname === "/PosTransaction" && options.method === "GET") {
        return Response.json({
          data: [
            {
              invoiceId: "4257542",
              beneficiaryCode: "0061500147011",
              beneficiaryName: "Patient",
              status: "صرف",
              action: '<button data-inv_id="2026-4257542-2915466">view</button>',
            },
            {
              invoiceId: "4261754",
              beneficiaryCode: "0061640124427",
              beneficiaryName: "Patient Two",
              status: "صرف",
              action: '<button data-inv_id="2026-4261754-2919972">view</button>',
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
  await using app = await listen(server);

  const result = await fetchJson(`${app.url}/api/bridge-sessions/${session.bridge_session_id}/historical-transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-a" },
    body: JSON.stringify({ dateFrom: "2026-09-20", dateTo: "2026-09-20" }),
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.raw_count, 2);
  assert.deepEqual(result.body.rows.map((row) => row.invoice_key), [
    "2026-4257542-2915466",
    "2026-4261754-2919972",
  ]);
  assert.deepEqual(redirectedUrls, [
    "http://his.phif.gov.ly/pharmacyFilteredtransactions",
    "https://his.phif.gov.ly/pharmacyFilteredtransactions",
  ]);
});

test("historical upstream errors return safe diagnostics without raw PHIF HTML", async () => {
  const store = new BridgeSessionStore();
  const session = store.create("pharmacy-a");
  const server = createPhifBridgeServer({
    secret: SECRET,
    store,
    fetchImpl: async (input, options = {}) => {
      const url = new URL(String(input));
      if (url.pathname === "/showPharmacyFilterTransactions" && options.method === "GET") {
        return new Response('<form method="POST"><input type="hidden" name="_token" value="secret-token"></form>', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("<html><title>PHIF-500</title><body>Server Error patient hidden</body></html>", {
        status: 500,
        headers: { "content-type": "text/html" },
      });
    },
  });
  await using app = await listen(server);

  const response = await fetch(`${app.url}/api/bridge-sessions/${session.bridge_session_id}/historical-transactions`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-phif-bridge-secret": SECRET, "x-pharmacy-id": "pharmacy-a" },
    body: JSON.stringify({ dateFrom: "2026-09-20", dateTo: "2026-09-21" }),
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.diagnostic.status, 500);
  assert.equal(body.diagnostic.classification, "phif_error_page");
  assert.doesNotMatch(JSON.stringify(body), /secret-token|patient hidden|<html/i);
});

test("historical transaction parser extracts invoice keys from HTML", () => {
  const rows = parseHistoricalTransactions(`
    <table><tr>
      <td>4197020</td><td>0061500147011</td><td>Patient</td><td>confirmed</td>
      <td><a href="/getTransaction/2026-4197020-2857276">view</a></td>
    </tr></table>
  `);

  assert.equal(rows[0].invoice_key, "2026-4197020-2857276");
  assert.equal(rows[0].card_number, "0061500147011");
});

test("today transaction parsing preserves leading-zero card numbers", () => {
  const rows = parseTodayTransactions({
    data: [{
      invoiceId: "INV-1",
      beneficiaryCode: "0012345",
      beneficiaryName: "Patient",
      status: "done",
      action: '<button data-inv_id="KEY-1"></button>',
    }],
  });

  assert.equal(rows[0].card_number, "0012345");
  assert.equal(rows[0].invoice_key, "KEY-1");
});

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    [Symbol.asyncDispose]: async () => {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

function captureResponse() {
  return {
    status: null,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = { ...this.headers, ...headers };
    },
    end(body = "") {
      this.body = String(body);
    },
  };
}
