import { connect } from "node:http2";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "http2-settings",
]);

export async function phifHttp2Fetch(input, init = {}) {
  const url = new URL(input);
  if (init.signal?.aborted) {
    const error = new Error("PHIF HTTP/2 request aborted");
    error.name = "AbortError";
    throw error;
  }
  const method = (init.method || "GET").toUpperCase();
  const body = await bodyToBuffer(init.body);
  const session = connect(url.origin, connectionOptions(url));

  return await new Promise((resolve, reject) => {
    let settled = false;
    let responseHeaders = null;
    let request = null;
    const chunks = [];

    const cleanup = () => {
      init.signal?.removeEventListener("abort", onAbort);
      session.close();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      init.signal?.removeEventListener("abort", onAbort);
      request?.close();
      session.destroy();
      reject(error);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        const status = Number(responseHeaders?.[":status"] || 0);
        const headers = responseHeadersToFetchHeaders(responseHeaders || {});
        const responseBody = decodeResponseBody(Buffer.concat(chunks), headers);
        resolve(new Response(method === "HEAD" || [204, 205, 304].includes(status) ? null : responseBody, { status, headers }));
      } catch (error) {
        reject(error);
      }
    };
    const onAbort = () => {
      const error = new Error("PHIF HTTP/2 request aborted");
      error.name = "AbortError";
      fail(error);
    };

    if (init.signal?.aborted) {
      onAbort();
      return;
    }
    init.signal?.addEventListener("abort", onAbort, { once: true });

    session.once("error", fail);
    request = session.request(requestHeaders(url, method, init.headers, body), { endStream: method === "GET" || method === "HEAD" || body.length === 0 });
    request.once("error", fail);
    request.once("response", (headers) => {
      responseHeaders = headers;
    });
    request.on("data", (chunk) => chunks.push(chunk));
    request.once("end", finish);

    if (method !== "GET" && method !== "HEAD" && body.length > 0) {
      request.end(body);
    } else {
      request.end();
    }
  });
}

function connectionOptions(url) {
  if (url.protocol !== "https:") return {};
  return {
    servername: url.hostname,
    rejectUnauthorized: true,
  };
}

function requestHeaders(url, method, headersInit, body) {
  const headers = {
    ":method": method,
    ":scheme": url.protocol.replace(":", ""),
    ":authority": url.host,
    ":path": `${url.pathname}${url.search}`,
  };
  const incoming = new Headers(headersInit || {});
  for (const [name, value] of incoming.entries()) {
    const lower = name.toLowerCase();
    if (lower.startsWith(":") || HOP_BY_HOP_HEADERS.has(lower)) continue;
    headers[lower] = value;
  }
  if (!headers["accept-encoding"]) headers["accept-encoding"] = "gzip, deflate, br";
  if (body.length > 0 && !headers["content-length"]) headers["content-length"] = String(body.length);
  return headers;
}

async function bodyToBuffer(body) {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  if (typeof body === "string") return Buffer.from(body);
  if (typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
  return Buffer.from(String(body));
}

function responseHeadersToFetchHeaders(responseHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(responseHeaders)) {
    if (name.startsWith(":")) continue;
    if (Array.isArray(value)) {
      value.forEach((entry) => headers.append(name, String(entry)));
    } else if (value !== undefined) {
      headers.append(name, String(value));
    }
  }
  return headers;
}

function decodeResponseBody(body, headers) {
  const encoding = (headers.get("content-encoding") || "").toLowerCase();
  if (!encoding || body.length === 0) return body;
  headers.delete("content-encoding");
  headers.delete("content-length");
  if (encoding.includes("br")) return brotliDecompressSync(body);
  if (encoding.includes("gzip")) return gunzipSync(body);
  if (encoding.includes("deflate")) return inflateSync(body);
  return body;
}
