export const PHIF_BASE_URL = "https://his.phif.gov.ly";

const ALLOWED_GET_PATHS = [
  /^\/home$/,
  /^\/toDaysTransaction$/,
  /^\/showPharmacyFilterTransactions$/,
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
      },
      body,
    }, this.timeoutMs);
    const text = await response.text();
    const location = response.headers.get("location") || "";
    const contentType = response.headers.get("content-type") || "";
    if (response.status >= 300 && response.status < 400) {
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

function looksLikeLoginPage(html) {
  return /<form[^>]+action=["'][^"']*\/login["']/i.test(html)
    || /<input[^>]+name=["']password["']/i.test(html);
}
