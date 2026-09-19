import { randomBytes } from "node:crypto";

export class BridgeSessionStore {
  constructor({ ttlMs = 4 * 60 * 60 * 1000, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.sessions = new Map();
  }

  create(pharmacyId) {
    const cleanPharmacyId = normalizePharmacyId(pharmacyId);
    if (!cleanPharmacyId) throw new Error("pharmacy_id is required");
    const timestamp = new Date(this.now()).toISOString();
    const session = {
      bridge_session_id: randomBytes(32).toString("base64url"),
      pharmacy_id: cleanPharmacyId,
      cookieJar: new Map(),
      created_at: timestamp,
      last_activity: timestamp,
      expires_at: new Date(this.now() + this.ttlMs).toISOString(),
    };
    this.sessions.set(session.bridge_session_id, session);
    return publicSession(session);
  }

  get(sessionId, pharmacyId) {
    const session = this.sessions.get(String(sessionId || ""));
    if (!session) return null;
    if (isExpired(session, this.now)) {
      this.sessions.delete(session.bridge_session_id);
      return null;
    }
    const cleanPharmacyId = normalizePharmacyId(pharmacyId);
    if (cleanPharmacyId && session.pharmacy_id !== cleanPharmacyId) return null;
    session.last_activity = new Date(this.now()).toISOString();
    return session;
  }

  clear(sessionId, pharmacyId) {
    const session = this.get(sessionId, pharmacyId);
    if (!session) return false;
    return this.sessions.delete(session.bridge_session_id);
  }

  cleanupExpired() {
    for (const session of this.sessions.values()) {
      if (isExpired(session, this.now)) this.sessions.delete(session.bridge_session_id);
    }
  }
}

export function publicSession(session) {
  return {
    bridge_session_id: session.bridge_session_id,
    pharmacy_id: session.pharmacy_id,
    created_at: session.created_at,
    last_activity: session.last_activity,
    expires_at: session.expires_at,
  };
}

function normalizePharmacyId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isExpired(session, now) {
  return Date.parse(session.expires_at) <= now();
}
