import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Pencil, Search, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getActualStockLinkEditor, saveActualStockLink } from "@/lib/actual-stock-links.functions";

export function ActualStockLinks({ itemIds = [], onClose }: { itemIds?: string[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const read = useServerFn(getActualStockLinkEditor);
  const save = useServerFn(saveActualStockLink);
  const [itemId, setItemId] = useState(itemIds[0] ?? "");
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const query = useQuery({ queryKey: ["actual_stock_links", itemId], queryFn: () => read({ data: { itemId: itemId || undefined } }), retry: false });
  const data = query.data;
  const existing = data?.history.find((link: any) => link.phif_invoice_item_id === itemId);
  useEffect(() => { setTargetId(""); setSearch(""); setConfirmed(false); setError(""); setNotice(""); }, [itemId]);
  const candidates = (data?.stocks ?? []).filter((stock: any) => !search.trim()
    || [stock.brand_name, stock.strength, stock.dosage_unit].join(" ").toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a: any, b: any) => Number(b.strength === data?.item?.strength) - Number(a.strength === data?.item?.strength));
  const target: any = data?.stocks.find((stock: any) => stock.id === targetId);

  async function submit(revoke = false) {
    if (lock.current || !confirmed) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      await save({ data: { itemId, targetId: revoke ? null : targetId, expectedVersion: existing?.version ?? 0, confirmed: true, revoke } });
      await queryClient.invalidateQueries({ predicate: q => ["actual_stock_links", "management_audit", "treasury_report", "management_profit_analysis", "report_item_tracking", "report_item_search", "reference_items", "reference_item", "management_monthly_report"].includes(String(q.queryKey[0])) });
      setTargetId(""); setConfirmed(false);
      await query.refetch();
      setNotice(revoke ? "تم إلغاء الربط والعودة للمطابقة الآلية" : "تم حفظ المطابقة اليدوية");
    } catch (e) { setError((e as Error).message || "لم يُحفظ الربط"); }
    finally { lock.current = false; setBusy(false); }
  }

  return <Sheet open onOpenChange={open => !open && !busy && onClose()}>
    <SheetContent side="bottom" className="mx-auto max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-t-lg" dir="rtl">
      <SheetHeader className="text-right"><SheetTitle>ربط Actual بالمخزون</SheetTitle></SheetHeader>
      <div className="mt-4 space-y-3">
        {query.isLoading && <p>جارٍ التحميل...</p>}
        {(query.error || error) && <p role="alert" className="text-sm text-red-700">{error || (query.error as Error)?.message}</p>}
        {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
        {data && !data.available && <p className="text-sm text-amber-900">الربط اليدوي غير مفعّل بعد. يلزم تطبيق migration الروابط قبل الحفظ.</p>}
        {data?.available && <>
          {itemIds.length > 1 && <label className="block text-sm">بند الفاتورة
            <select className="mt-1 w-full rounded-md border bg-background p-2" value={itemId} disabled={busy} onChange={e => setItemId(e.target.value)}>
              {itemIds.map((id, index) => <option key={id} value={id}>البند {index + 1}</option>)}
            </select>
          </label>}
          {data.item && <>
            <div className="border-b pb-3 text-sm">
              <strong className="block break-words">{data.item.brand} · {data.item.strength}</strong>
              <span className="text-muted-foreground">فاتورة {data.item.invoice?.invoice_number} · {data.item.invoice?.dispensing_date} · الكمية {data.item.quantity} · {data.item.unit || "وحدة غير مسجلة"}</span>
            </div>
            {existing?.is_active && <p className="text-sm text-emerald-800">مطابقة يدوية: {existing.target?.brand_name} · {existing.target?.strength}</p>}
            <div className="relative"><Search className="absolute right-2 top-3 size-4 text-muted-foreground" /><Input className="pr-8" aria-label="بحث في مخزون الصيدلية" placeholder="اسم صنف المخزون أو التركيز" value={search} onChange={e => setSearch(e.target.value)} disabled={busy} /></div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {candidates.length === 0 && <p className="p-3 text-sm text-muted-foreground">لا توجد نتائج.</p>}
              {candidates.map((stock: any) => <button type="button" disabled={busy} key={stock.id} aria-pressed={targetId === stock.id} onClick={() => { setTargetId(stock.id); setConfirmed(false); }} className={`block w-full rounded-md border p-2 text-right text-sm ${targetId === stock.id ? "border-teal-600 bg-teal-50" : "bg-background"}`}>
                <strong className="block break-words">{stock.brand_name}</strong>
                <span className="text-muted-foreground">{stock.strength} · {stock.dosage_unit || "شكل غير مسجل"} · العبوة {stock.package_quantity ?? "غير مسجلة"} · الأشرطة {stock.strips_quantity ?? "غير مسجلة"}</span>
              </button>)}
            </div>
            {target && <div className="rounded-md border border-teal-200 p-3 text-sm"><p>من: {data.item.brand} · {data.item.strength} · {data.item.unit || "شكل / وحدة غير مسجلة"} · العبوة {data.item.package_quantity ?? "غير مسجلة"}</p><p>إلى: {target.brand_name} · {target.strength} · {target.dosage_unit} · العبوة {target.package_quantity ?? "غير مسجلة"}</p></div>}
            <p className="text-xs text-muted-foreground">القرار يخص بند هذه الفاتورة فقط. لا يغيّر الاسم الأصلي ولا يؤكد وحدة التكلفة أو الربح.</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />أؤكد هوية الصنف والتغيير المختار.</label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!confirmed || !target || busy} onClick={() => submit()}><Link2 className="size-4" />حفظ الربط</Button>
              {existing?.is_active && <Button variant="outline" disabled={!confirmed || busy} onClick={() => submit(true)}><Unlink className="size-4" />إلغاء الربط</Button>}
            </div>
            {data.operations.length > 0 && <details className="border-t pt-2 text-xs"><summary>سجل التغييرات</summary>{data.operations.map((op: any, index: number) => <p className="py-1" key={index}>{op.action.endsWith("revoke") ? "إلغاء" : "حفظ / تعديل"} · {op.actor} · {op.at}</p>)}</details>}
          </>}
          <details open={!itemId} className="border-t pt-2 text-sm"><summary>الروابط المحفوظة ({data.history.length})</summary>
            {data.history.map((link: any) => <div key={link.id} className="flex items-center justify-between gap-2 border-b py-2">
              <div className="min-w-0 break-words"><strong>{link.source?.brand} · {link.source?.strength}</strong><p className="text-xs">{link.target?.brand_name} · {link.is_active ? "مطابقة يدوية" : "ملغاة"}</p><p className="text-xs text-muted-foreground">{link.updated_actor} · {link.updated_at}</p></div>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setItemId(link.phif_invoice_item_id)}><Pencil className="size-4" />مراجعة</Button>
            </div>)}
          </details>
        </>}
      </div>
    </SheetContent>
  </Sheet>;
}
