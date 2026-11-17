import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { runDefinitionAudit } from "../definition-audit.server";
import { createDefinitionAuditStore } from "../definition-audit.local";

type AuditReport = Awaited<ReturnType<typeof runDefinitionAudit>>;
const scope = (pharmacyId = "pharmacy-a", userId = "admin-a") => ({ pharmacyId, userId });
const stores: ReturnType<typeof createDefinitionAuditStore>[] = [];
const store = (factory: IDBFactory, name = "definition-audit-test") => {
  const instance = createDefinitionAuditStore({ indexedDB: factory, name });
  stores.push(instance);
  return instance;
};
const report = (patch: Partial<AuditReport> = {}): AuditReport => ({
  runId: "00000000-0000-4000-8000-000000000001", schemaVersion: 1, ruleVersion: "definitions-2", pharmacyId: "pharmacy-a",
  startedAt: "2026-11-17T10:00:00.000Z", finishedAt: "2026-11-17T10:05:00.000Z",
  evidenceFingerprint: "fingerprint", coverage: "observed_stable", consistency: "unverified_snapshot", previousRun: null,
  notice: "ملخص عام", manifest: [{ source: "items", count: 5, verificationCount: 5, reason: null, status: "observed_stable" }],
  counts: { invoices: 2, items: 5, definitions: 1, errors: 0, reviews: 1, unverified: 0 },
  findingsTotal: 1, findingsTruncated: false,
  findings: [{
    id: "identity-and-record-key", code: "missing_definition", category: "review", severity: "medium",
    name: "ASPIRIN 75MG", reason: "تعريف غير محفوظ", action: "راجع الصنف", source: "phif", identity: "private-identity-key",
    records: ["private-record-id"], itemIds: ["private-item-id"],
    invoices: [{ id: "private-invoice-id", number: "private-invoice-number", month: "2026-10" }],
    itemCount: 3, invoiceCount: 2, recordCount: 1, evidenceTruncated: true,
    patientName: "PRIVATE PATIENT", insuranceCard: "0000012345",
  } as AuditReport["findings"][number]],
  ...patch,
});

afterEach(async () => { await Promise.all(stores.splice(0).map(instance => instance.close())); });

describe("local definition audit results", () => {
  it("preserves only a valid source digest for complete export after reopening, without adding identifiers", async () => {
    const factory = new IDBFactory();
    const db = store(factory);
    await db.save(scope(), report({ evidenceFingerprint: "a".repeat(64) }));
    await db.close();
    const restored = await store(factory).load(scope());
    expect(restored?.result.evidenceFingerprint).toBe("a".repeat(64));
    expect(restored?.result.findings[0].identity).toBeNull();
    expect(restored?.result.findings[0].itemIds).toEqual([]);
    await store(factory).save(scope(), report({ evidenceFingerprint: "not-a-safe-digest" }));
    expect((await store(factory).load(scope()))?.result.evidenceFingerprint).toBeNull();
  });
  it("restores the last completed summary after closing and reopening IndexedDB without invoice or patient details", async () => {
    const factory = new IDBFactory();
    const first = store(factory);
    await first.save(scope(), report());
    await first.close();

    const reopened = store(factory);
    const saved = await reopened.load(scope());
    expect(saved?.result.finishedAt).toBe("2026-11-17T10:05:00.000Z");
    expect(saved?.result.findings[0].months).toEqual(["2026-10"]);
    expect(saved?.result.findings[0].invoices).toEqual([]);
    expect(saved?.result.findings[0].itemIds).toEqual([]);
    expect(saved?.result.findings[0].records).toEqual([]);
    expect(JSON.stringify(saved)).not.toMatch(/private-invoice|private-item|private-record|PRIVATE PATIENT|0000012345|private-identity/);
  });

  it("isolates saved results by both pharmacy and user", async () => {
    const db = store(new IDBFactory());
    await db.save(scope(), report());
    expect(await db.load(scope("pharmacy-b", "admin-a"))).toBeNull();
    expect(await db.load(scope("pharmacy-a", "admin-b"))).toBeNull();
  });

  it("does not replace the previous complete result with an incomplete or failed run", async () => {
    const db = store(new IDBFactory());
    await db.save(scope(), report());
    await expect(db.save(scope(), report({ coverage: "incomplete", finishedAt: "2026-11-17T11:05:00.000Z" })))
      .rejects.toThrow("غير مكتمل");
    expect((await db.load(scope()))?.result.finishedAt).toBe("2026-11-17T10:05:00.000Z");
  });

  it("does not replace a newer completed result and clears only the active scope", async () => {
    const db = store(new IDBFactory());
    await db.save(scope(), report({ finishedAt: "2026-11-17T12:00:00.000Z" }));
    await db.save(scope(), report({ finishedAt: "2026-11-17T11:00:00.000Z" }));
    await db.save(scope("pharmacy-b", "admin-a"), report({ pharmacyId: "pharmacy-b" }));
    expect((await db.load(scope()))?.result.finishedAt).toBe("2026-11-17T12:00:00.000Z");
    await db.clear(scope());
    expect(await db.load(scope())).toBeNull();
    expect(await db.load(scope("pharmacy-b", "admin-a"))).not.toBeNull();
  });
});
