import { useSession } from "@tanstack/react-start/server";

export type PharmacySessionData = {
  pharmacy_id?: string;
  pharmacy_name?: string;
  unlocked_at?: number;
};

export const pharmacySessionConfig = {
  name: "phif_session",
  password: process.env.SESSION_SECRET ?? "dev-only-session-secret-please-set-SESSION_SECRET-in-env",
  maxAge: 60 * 60 * 12, // 12h
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    path: "/",
  },
};

export async function getPharmacySession() {
  return useSession<PharmacySessionData>(pharmacySessionConfig);
}

export async function requirePharmacySession() {
  const session = await getPharmacySession();
  if (!session.data.pharmacy_id) {
    throw new Error("Unauthorized: pharmacy not unlocked");
  }
  return {
    session,
    pharmacy_id: session.data.pharmacy_id,
    pharmacy_name: session.data.pharmacy_name ?? "",
  };
}

// PIN hashing using Node scrypt (stable, no native deps).
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, 32);
  return `s1:${salt.toString("hex")}:${key.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  try {
    const [v, saltHex, keyHex] = stored.split(":");
    if (v !== "s1" || !saltHex || !keyHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(keyHex, "hex");
    const actual = scryptSync(pin, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// Simple in-memory rate limiter (per-process; resets on cold start).
const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 60_000;

export function rateLimit(key: string): { ok: boolean; retryInMs?: number } {
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && rec.blockedUntil > now) {
    return { ok: false, retryInMs: rec.blockedUntil - now };
  }
  if (!rec || now - (rec as any).firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, blockedUntil: 0, firstAt: now } as any);
    return { ok: true };
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    rec.blockedUntil = now + WINDOW_MS;
    return { ok: false, retryInMs: WINDOW_MS };
  }
  return { ok: true };
}

export function clearRateLimit(key: string) {
  attempts.delete(key);
}