export const PHIF_BASE_URL = "https://his.phif.gov.ly";

const ALLOWED_GET_PATHS = [
  /^\/home$/,
  /^\/toDaysTransaction$/,
  /^\/showPharmacyFilterTransactions$/,
  /^\/pharmacyFilteredtransactions$/,
  /^\/PosTransaction$/,
  /^\/getTransaction\/[^/?#]+$/,
];

const ALLOWED_POST_FORM_PATHS = [
  /^\/showPharmacyFilterTransactions$/,
];

export class PhifClient {
  constructor({ fetchImpl = fetch, baseUrl = PHIF_BASE_URL, timeoutMs = 15000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  async getJson(path) {
    const response = await this.get(path, { accept: "application/json, text/javascript, */*; q=0.01" });
    if (!response.ok) return response;
    try {
      return { ...response, json: JSON.parse(response.text) };
    } catch {
      return { ...response, ok: false, parseError: true, message: "PHIF response was not valid JSON" };
    }
  }

  async getHtml(path) {
    return await this.get(path, { accept: "text/html,application/xhtml+xml" });
  }

  async postForm(path, fields) {
    if (!isAllowedPostFormPath(path)) {
      return {
        ok: false,
        status: 0,
        authRequired: false,
        blocked: true,
        text: "",
        message: "PHIF POST path is not allowed by the read-only bridge.",
      };
    }

    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (value !== undefined && value !== null) body.set(key, String(value));
    }

    const response = await fetchWithTimeout(this.fetchImpl, new URL(path, this.baseUrl), {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/javascript,*/*;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: PHIF_BASE_URL,
        Referer: new URL(path, PHIF_BASE_URL).toString(),
      },
      body,
    }, this.timeoutMs);
    const text = await response.text();
    const location = response.headers.get("location") || "";
    const contentType = response.headers.get("content-type") || "";
    if (response.status >= 300 && response.status < 400) {
      if (isLoginLocation(location)) {
        return { ok: false, status: response.status, authRequired: true, text, location, contentType };
      }
      const redirected = await followAllowedResultRedirects(location, {
        fetchImpl: this.fetchImpl,
        refererPath: path,
        timeoutMs: this.timeoutMs,
      });
      if (redirected) return redirected;
      return { ok: false, status: response.status, authRequired: isLoginLocation(location), text, location, contentType };
    }
    if (looksLikeLoginPage(text)) {
      return { ok: false, status: response.status, authRequired: true, text, contentType };
    }
    return { ok: response.ok, status: response.status, authRequired: false, text, contentType };
  }

  async get(path, { accept }) {
    if (!isAllowedReadPath(path)) {
      return {
        ok: false,
        status: 0,
        authRequired: false,
        blocked: true,
        text: "",
        message: "PHIF path is not allowed by the read-only bridge.",
      };
    }

    const response = await fetchWithTimeout(this.fetchImpl, new URL(path, this.baseUrl), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: accept },
    }, this.timeoutMs);
    const text = await response.text();
    const location = response.headers.get("location") || "";
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, authRequired: isLoginLocation(location), text, location };
    }
    if (looksLikeLoginPage(text)) {
      return { ok: false, status: response.status, authRequired: true, text };
    }
    return { ok: response.ok, status: response.status, authRequired: false, text, contentType: response.headers.get("content-type") || "" };
  }
}

export function isAllowedReadPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("..")) return false;
  let url;
  try {
    url = new URL(path, PHIF_BASE_URL);
  } catch {
    return false;
  }
  return url.origin === PHIF_BASE_URL && ALLOWED_GET_PATHS.some((pattern) => pattern.test(url.pathname));
}

export function isAllowedPostFormPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("..")) return false;
  let url;
  try {
    url = new URL(path, PHIF_BASE_URL);
  } catch {
    return false;
  }
  return url.origin === PHIF_BASE_URL && ALLOWED_POST_FORM_PATHS.some((pattern) => pattern.test(url.pathname));
}

export async function fetchWithTimeout(fetchImpl, input, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isLoginLocation(location) {
  if (!location) return true;
  try {
    return new URL(location, PHIF_BASE_URL).pathname === "/login";
  } catch {
    return true;
  }
}

async function followAllowedResultRedirects(location, { fetchImpl, refererPath, timeoutMs }) {
  let nextUrl = allowedRedirectUrl(location);
  if (!nextUrl) return null;
  const firstLocation = location;

  for (let redirectCount = 0; redirectCount < 3; redirectCount++) {
    const response = await fetchWithTimeout(fetchImpl, nextUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json,text/javascript,*/*;q=0.9",
        Referer: new URL(refererPath, PHIF_BASE_URL).toString(),
      },
    }, timeoutMs);
    const text = await response.text();
    const contentType = response.headers.get("content-type") || "";
    const location = response.headers.get("location") || "";
    const finalPath = `${nextUrl.pathname}${nextUrl.search}`;

    if (response.status >= 300 && response.status < 400) {
      if (isLoginLocation(location)) {
        return {
          ok: false,
          status: response.status,
          authRequired: true,
          text,
          location,
          contentType,
          redirectedFrom: firstLocation,
          finalPath,
        };
      }
      const allowedNext = allowedRedirectUrl(location);
      if (!allowedNext) {
        return {
          ok: false,
          status: response.status,
          authRequired: false,
          text,
          location,
          contentType,
          redirectedFrom: firstLocation,
          finalPath,
          message: "PHIF redirect target is not allowed by the read-only bridge.",
        };
      }
      nextUrl = allowedNext;
      continue;
    }

    if (looksLikeLoginPage(text)) {
      return {
        ok: false,
        status: response.status,
        authRequired: true,
        text,
        contentType,
        redirectedFrom: firstLocation,
        finalPath,
      };
    }
    return {
      ok: response.ok,
      status: response.status,
      authRequired: false,
      text,
      contentType,
      redirectedFrom: firstLocation,
      finalPath,
    };
  }

  return {
    ok: false,
    status: 0,
    authRequired: false,
    text: "",
    location: String(nextUrl),
    contentType: "",
    redirectedFrom: firstLocation,
    finalPath: `${nextUrl.pathname}${nextUrl.search}`,
    message: "PHIF redirect limit exceeded.",
  };
}

function allowedRedirectUrl(location) {
  if (!location) return null;
  try {
    const url = new URL(location, PHIF_BASE_URL);
    if (url.hostname !== "his.phif.gov.ly") return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (isAllowedReadPath(`${url.pathname}${url.search}`)) return url;
  } catch {
    return null;
  }
  return null;
}

function looksLikeLoginPage(html) {
  return /<form[^>]+action=["'][^"']*\/login["']/i.test(html)
    || /<input[^>]+name=["']password["']/i.test(html);
}
