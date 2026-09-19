import { PHIF_BASE_URL, fetchWithTimeout, isAllowedReadPath } from "./client.js";

const AUTH_POST_PATHS = new Set([
  "/login",
  "/logout",
  "/password",
  "/password/email",
  "/password/reset",
  "/two-factor-challenge",
  "/user/confirmed-password-status",
  "/user/confirm-password",
]);

export async function phifSessionFetch(session, input, options = {}) {
  const response = await fetchWithTimeout(options.fetchImpl ?? fetch, input, {
    ...options,
    headers: withSessionCookies(session, options.headers),
    redirect: "manual",
  }, options.timeoutMs ?? 15000);
  rememberSetCookies(session, response);
  return response;
}

export function hasPhifSessionCookies(session) {
  return session.cookieJar.size > 0;
}

export async function getPhifSessionStatus(session, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const response = await phifSessionFetch(session, new URL("/home", PHIF_BASE_URL), {
    method: "GET",
    headers: { Accept: "text/html,application/xhtml+xml" },
    fetchImpl,
    timeoutMs,
  });
  const location = response.headers.get("location");
  return {
    hasSessionCookies: hasPhifSessionCookies(session),
    status: response.status,
    authenticated: response.status >= 200 && response.status < 300,
    redirectPath: location ? toLocalProxyLocation(location) : null,
  };
}

export async function proxyPhifLoginRequest(req, res, localUrl, session, options = {}) {
  const targetPath = decodeProxyPath(localUrl, session.bridge_session_id);
  const targetUrl = new URL(targetPath, PHIF_BASE_URL);

  if (targetUrl.origin !== PHIF_BASE_URL || targetUrl.pathname.includes("..")) {
    return writeText(res, 400, "Invalid PHIF proxy path");
  }

  if (!isAllowedProxyRequest(req.method, targetUrl.pathname)) {
    return writeText(res, 405, "Only PHIF login/session requests are allowed through this proxy");
  }

  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRaw(req);
  let response;
  try {
    response = await phifSessionFetch(session, targetUrl, {
      method: req.method,
      body,
      headers: forwardHeaders(req.headers, targetUrl),
      fetchImpl: options.fetchImpl ?? fetch,
      timeoutMs: options.timeoutMs ?? 15000,
    });
  } catch {
    return writeJson(res, 502, {
      ok: false,
      error: "PHIF proxy fetch failed",
      method: req.method,
      targetPath: targetUrl.pathname,
      bodyBytes: body?.length || 0,
      contentType: req.headers["content-type"] || null,
      stage: "upstream-fetch",
    });
  }

  const location = response.headers.get("location");
  if (location) {
    res.setHeader("Location", toLocalProxyLocation(location, session.bridge_session_id));
  }

  if (req.method === "GET" && targetUrl.pathname === "/home" && response.status >= 200 && response.status < 300) {
    writeLoginSuccess(res);
    return;
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const outgoing = contentType.includes("text/html")
    ? rewriteHtml(buffer.toString("utf8"), session.bridge_session_id)
    : buffer;

  res.writeHead(response.status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  res.end(outgoing);
}

export function isAllowedProxyRequest(method, pathname) {
  if (method === "GET" || method === "HEAD") return isAllowedProxyGet(pathname);
  if (method === "POST") return AUTH_POST_PATHS.has(pathname);
  return false;
}

export function isAllowedProxyGet(pathname) {
  if (isAllowedReadPath(pathname)) return true;
  if (["/", "/login", "/two-factor-challenge", "/user/confirm-password"].includes(pathname)) return true;
  if (/^\/captcha\/default$/i.test(pathname)) return true;
  if (/\/[^/]+\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|map)$/i.test(pathname)) return true;
  return /^\/(assets|build|css|js|images|img|fonts)\//i.test(pathname);
}

export function decodeProxyPath(localUrl, sessionId) {
  const prefix = `/phif-login/${encodeURIComponent(sessionId)}`;
  const raw = localUrl.pathname.startsWith(prefix)
    ? localUrl.pathname.slice(prefix.length)
    : localUrl.pathname.replace(/^\/phif-login\/[^/]+/, "");
  return `${raw || "/home"}${localUrl.search}`;
}

export function forwardHeaders(headers, targetUrl) {
  const next = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if ([
      "host",
      "cookie",
      "connection",
      "content-length",
      "origin",
      "referer",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-user",
    ].includes(lower)) continue;
    next.set(name, value);
  }
  next.set("origin", PHIF_BASE_URL);
  next.set("referer", new URL(targetUrl.pathname + targetUrl.search, PHIF_BASE_URL).toString());
  return next;
}

export function rewriteHtml(html, sessionId) {
  const prefix = `/phif-login/${encodeURIComponent(sessionId)}`;
  return html
    .replace(/(href|src|action)=["']https?:\/\/his\.phif\.gov\.ly([^"']*)["']/gi, `$1="${prefix}$2"`)
    .replace(/(href|src|action)=["']\/([^"']*)["']/gi, (match, attrName, path) => {
      if (path.startsWith(`phif-login/${encodeURIComponent(sessionId)}/`)) return match;
      if (path.startsWith("phif-login/")) return match;
      return `${attrName}="${prefix}/${path}"`;
    });
}

export function toLocalProxyLocation(location, sessionId) {
  const url = new URL(location, PHIF_BASE_URL);
  if (url.hostname !== "his.phif.gov.ly") return location;
  return `/phif-login/${encodeURIComponent(sessionId)}${url.pathname}${url.search}`;
}

function withSessionCookies(session, headers = {}) {
  const next = new Headers(headers);
  const cookieHeader = [...session.cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  if (cookieHeader) next.set("cookie", cookieHeader);
  next.set("accept", next.get("accept") || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  return next;
}

function rememberSetCookies(session, response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : splitSetCookieHeader(response.headers.get("set-cookie"));

  values.forEach((value) => {
    const [pair] = value.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) return;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    if (!name) return;
    if (!cookieValue) session.cookieJar.delete(name);
    else session.cookieJar.set(name, cookieValue);
  });
}

function splitSetCookieHeader(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;,]+=)/g);
}

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function writeText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

function writeJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function writeLoginSuccess(res) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>تم تسجيل الدخول</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; }
    section { max-width: 420px; width: 100%; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; text-align: center; }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 0; line-height: 1.7; color: #334155; }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>تم تسجيل الدخول إلى PHIF بنجاح</h1>
      <p>يمكنك إغلاق هذه الصفحة والعودة إلى PHIF Tracker.</p>
    </section>
  </main>
</body>
</html>`);
}

export const testHooks = {
  writeLoginSuccess,
};
