import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { importExcelRows } from "@/lib/dispensing.functions";
import { Upload, FileSpreadsheet, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/import")({
  component: () => <Gate><ImportPage /></Gate>,
});

type ParsedRow = { patient_name: string; insurance_card_number: string | null; dispensing_dates: string[] };

function pickColumn(row: Record<string, unknown>, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const k = keys.find((kk) => kk.trim() === cand);
    if (k) return String(row[k] ?? "");
  }
  return null;
}

function parseDates(raw: string | null): string[] {
  if (!raw) return [];
  const parts = String(raw)
    .split(/[\n,،;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    // Try YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY
    let d: Date | null = null;
    const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(p);
    const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(p);
    if (iso) d = new Date(`${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`);
    else if (dmy) d = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
    else {
      const n = Number(p);
      if (!isNaN(n) && n > 20000) {
        // Excel serial
        d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      }
    }
    if (d && !isNaN(d.getTime())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function ImportPage() {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | { created: number; matchedByCard: number; needsReview: number; txAdded: number }>(null);
  const qc = useQueryClient();
  const importFn = useServerFn(importExcelRows);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const parsed: ParsedRow[] = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
      for (const r of json) {
        const name = pickColumn(r, ["اسم المشترك", "الاسم", "Name", "patient_name"]);
        if (!name || !String(name).trim()) continue;
        const card = pickColumn(r, ["رقم التأميني", "رقم البطاقة", "Card", "insurance_card_number"]);
        const dates = pickColumn(r, ["تواريخ الصرف", "كل التواريخ", "التواريخ", "dispensing_dates"]);
        parsed.push({
          patient_name: String(name).trim(),
          insurance_card_number: card ? String(card).trim() : null,
          dispensing_dates: parseDates(dates),
        });
      }
    }
    setRows(parsed);
    setResult(null);
  }

  async function onImport() {
    if (!rows.length) return;
    setBusy(true);
    try {
      // Chunk to avoid huge payloads
      const chunkSize = 200;
      let created = 0, matchedByCard = 0, needsReview = 0, txAdded = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const res = await importFn({ data: { rows: chunk } });
        if (!res.ok) throw new Error("import_failed");
        created += res.created;
        matchedByCard += res.matchedByCard;
        needsReview += res.needsReview;
        txAdded += res.txAdded;
      }
      setResult({ created, matchedByCard, needsReview, txAdded });
      toast.success("اكتمل الاستيراد");
      await qc.invalidateQueries({ queryKey: ["patient_status"] });
    } catch (e: any) {
      toast.error(e?.message ?? "فشل الاستيراد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">استيراد من Excel</h1>

      <Card className="p-4 space-y-4">
        <div className="text-sm text-muted-foreground">
          يقبل الملف أعمدة عربية: <b>اسم المشترك</b>، <b>رقم التأميني</b>، <b>تواريخ الصرف</b>. يتم كشف
          التكرار تلقائياً برقم البطاقة.
        </div>
        <div>
          <Label htmlFor="file">اختر ملف Excel</Label>
          <Input id="file" type="file" accept=".xlsx,.xls" onChange={onFile} />
          {fileName && <div className="text-xs text-muted-foreground mt-1">{fileName}</div>}
        </div>

        {rows.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2 bg-secondary/40">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4 text-primary" /> تم اكتشاف {rows.length} سجل
            </div>
            <div className="text-xs text-muted-foreground">
              إجمالي التواريخ: {rows.reduce((n, r) => n + r.dispensing_dates.length, 0)}
            </div>
            <Button onClick={onImport} disabled={busy} className="w-full h-11">
              <Upload className="h-4 w-4 ml-2" />
              {busy ? "جاري الاستيراد…" : "استيراد إلى قاعدة البيانات"}
            </Button>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2 font-medium text-success-foreground/90">
              <CheckCircle2 className="h-4 w-4" /> اكتمل الاستيراد
            </div>
            <div>مرضى جدد: {result.created}</div>
            <div>مطابقة برقم البطاقة: {result.matchedByCard}</div>
            <div>يحتاج مراجعة (تطابق اسم): {result.needsReview}</div>
            <div>سجلات صرف مضافة: {result.txAdded}</div>
          </div>
        )}
      </Card>
    </div>
  );
}