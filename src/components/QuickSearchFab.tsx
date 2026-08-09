import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useNavigate } from "@tanstack/react-router";
import { usePatientStatuses } from "@/lib/queries";
import { normalizeArabicName } from "@/lib/name-normalize";
import { Badge } from "@/components/ui/badge";

export function QuickSearchFab() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const { data: rows } = usePatientStatuses();

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else setQ("");
  }, [open]);

  const results = useMemo(() => {
    if (!rows || !q.trim()) return [];
    const qn = normalizeArabicName(q);
    const digits = q.replace(/\D/g, "");
    return rows
      .filter(
        (r) =>
          normalizeArabicName(r.patient_name).includes(qn) ||
          (digits && (r.insurance_card_number ?? "").includes(digits)) ||
          (digits && (r.phone ?? "").includes(digits)),
      )
      .slice(0, 30);
  }, [rows, q]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="بحث سريع"
        className="fixed z-40 bottom-24 md:bottom-6 left-4 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition"
      >
        <Search className="h-6 w-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col">
          <div className="p-3 border-b flex items-center gap-2">
            <button
              onClick={() => setOpen(false)}
              className="h-10 w-10 rounded-md flex items-center justify-center hover:bg-accent"
              aria-label="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
            <Input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ابحث بالاسم أو رقم البطاقة أو الهاتف…"
              className="h-12 text-base"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {results.length === 0 && q && (
              <div className="text-center text-muted-foreground py-10">لا نتائج</div>
            )}
            {results.map((r) => (
              <button
                key={r.patient_id}
                onClick={() => {
                  setOpen(false);
                  nav({ to: "/patients/$id", params: { id: r.patient_id } });
                }}
                className="w-full text-right p-3 rounded-lg border hover:border-primary bg-card"
              >
                <div className="flex items-center gap-2">
                  <div className="font-semibold flex-1 truncate">{r.patient_name}</div>
                  {r.phone && <Badge variant="outline" className="text-[10px]">هاتف</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex gap-2 flex-wrap" dir="ltr">
                  {r.insurance_card_number && <span>{r.insurance_card_number}</span>}
                  {r.phone && <span>{r.phone}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}