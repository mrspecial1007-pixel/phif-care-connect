import { z } from "zod";

export const auditReviewExportInput = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  ruleVersion: z.literal("definitions-2"),
  finishedAt: z.string().datetime(),
}).strict();
export type AuditReviewExportInput = z.infer<typeof auditReviewExportInput>;
export type AuditReviewRow = {
  key: string; identity: string | null; source: string; name: string; strength: string; form: string;
  reasons: string[]; itemCount: number; invoiceCount: number;
  boxSize: number | null; baseUnit: string | null; supplierUnit: string | null;
  status: string;
};
export type AuditReviewExport = {
  schemaVersion: 1; pharmacyId: string; fingerprint: string; ruleVersion: string;
  auditFinishedAt: string; verifiedAt: string; findingsCount: number;
  rows: AuditReviewRow[];
  definitions: { rowKey: string; id: string; identity: string; version: number | null;
    boxSize: number | null; baseUnit: string | null; supplierUnit: string | null }[];
  records: { rowKey: string; table: string; id: string }[];
};
