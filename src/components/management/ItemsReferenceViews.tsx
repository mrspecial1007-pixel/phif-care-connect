import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Boxes, CalendarClock, ChevronLeft, Edit3, Loader2, PackagePlus, Pill, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ReportBackLink } from "./ReportBackLink";
import { getReferenceItem, listReferenceItems } from "@/lib/items-reference.functions";

type Src = "Actual" | "PHIF Supplier";
const money = (v: number | null) => (v == null ? "غير متاح" : `${v.toLocaleString("ar-LY", { maximumFractionDigits: 3 })} د.ل`);
const dateLabel = (v: string | null) => (v ? new Date(v).toLocaleDateString("ar-LY", { day: "numeric", month: "short", year: "numeric" }) : "—");

function SourceBadges({ sources }: { sources: Src[] }) {
  return <div className="flex flex-wrap gap-1.5">{sources.map(source => <Badge key={source} variant={source === "Actual" ? "default" : "secondary"} className="rounded-md px-2 py-0.5 text-[11px] font-medium">{source}</Badge>)}</div>;
}
function StateBox({ loading, error, empty }: { loading?: boolean; error?: unknown; empty?: string }) {
  if (loading) return <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />جارٍ التحميل…</div>;
  if (error) return <div className="border-y py-8 text-center text-sm text-destructive">تعذر تحميل الأصناف، حاول مجددًا</div>;
  return <div className="border-y py-8 text-center"><Pill className="mx-auto mb-2 size-6 text-muted-foreground" /><p className="font-medium">{empty}</p></div>;
}

export function ItemsReferencePage() {
  const [search, setSearch] = useState("");
  const { data = [], isLoading, error } = useQuery({ queryKey: ["reference_items"], queryFn: () => listReferenceItems(), staleTime: 60_000 });
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return data;
    return data.filter(item => [item.ingredient, item.strength, item.form].some(value => (value ?? "").toLowerCase().includes(term)));
  }, [search, data]);

  return <div className="space-y-4" dir="rtl">
    <header className="space-y-3">
      <ReportBackLink to="/management/reports" label="مركز التقارير" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0"><h1 className="text-xl font-bold">الأصناف</h1><p className="mt-1 text-sm text-muted-foreground">مرجع الأدوية مرتب حسب الاسم العلمي</p></div>
        <Button size="sm" className="shrink-0" onClick={() => undefined}><PackagePlus className="size-4" />إضافة صنف</Button>
      </div>
    </header>
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="البحث في الأصناف" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالمادة أو التركيز أو الشكل" className="h-11 pr-10" />
    </div>
    {isLoading || error ? <StateBox loading={isLoading} error={error} /> : <>
      <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{filtered.length} صنف</span><span>بالاسم العلمي</span></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map(item => <Link key={item.id} to="/management/reports/items/$itemId" params={{ itemId: item.id }} className="block min-w-0">
          <Card className="p-3 transition-colors hover:bg-accent/40">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0 space-y-2">
                <div><h2 className="truncate font-bold" dir="ltr">{item.ingredient}</h2><p className="mt-0.5 text-sm text-muted-foreground">{[item.strength, item.form].filter(Boolean).join(" · ") || "—"}</p></div>
                <SourceBadges sources={item.sources} />
              </div>
              <div className="flex shrink-0 items-center gap-2"><span className="text-xs font-medium">{item.beneficiaries} مستفيد</span><ChevronLeft className="size-4 text-muted-foreground" /></div>
            </div>
          </Card>
        </Link>)}
      </div>
      {filtered.length === 0 && <StateBox empty="لا توجد أصناف مطابقة" />}
    </>}
  </div>;
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof Pill; children: React.ReactNode }) {
  return <section className="space-y-2"><div className="flex items-center gap-2"><Icon className="size-4 text-primary" /><h2 className="font-bold">{title}</h2></div>{children}</section>;
}
const Empty = ({ text }: { text: string }) => <Card className="p-3 text-center text-sm text-muted-foreground">{text}</Card>;

export function ItemReferenceDetailsPage({ itemId }: { itemId: string }) {
  const { data: item, isLoading, error } = useQuery({ queryKey: ["reference_item", itemId], queryFn: () => getReferenceItem({ data: { id: itemId } }) });
  if (isLoading || error || !item) return <div className="space-y-4" dir="rtl"><ReportBackLink to="/management/reports/items" label="الأصناف" /><StateBox loading={isLoading} error={error} empty="الصنف غير موجود" /></div>;
  return <div className="space-y-5" dir="rtl">
    <header className="space-y-3">
      <ReportBackLink to="/management/reports/items" label="الأصناف" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0"><p className="text-xs text-muted-foreground">تعريف الصنف العلمي</p><h1 className="truncate text-xl font-bold" dir="ltr">{item.ingredient}</h1><p className="mt-1 text-sm text-muted-foreground">{[item.strength, item.form].filter(Boolean).join(" · ") || "—"}</p></div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => undefined}><Edit3 className="size-4" />تعديل التعريف</Button>
      </div>
      <SourceBadges sources={item.sources} />
    </header>

    <DetailSection title="نظرة عامة" icon={Pill}>
      <div className="grid grid-cols-3 border-y text-center"><div className="p-3"><strong className="block text-base">{item.beneficiaryCount}</strong><span className="text-[11px] text-muted-foreground">مستفيد</span></div><div className="border-x p-3"><strong className="block text-base">{item.dispenseCount}</strong><span className="text-[11px] text-muted-foreground">صرفية</span></div><div className="p-3"><strong className="block text-base">{item.actualProducts.length}</strong><span className="text-[11px] text-muted-foreground">منتج Actual</span></div></div>
    </DetailSection>

    <DetailSection title="المستفيدون" icon={Users}>
      {item.beneficiaries.length ? <Card className="divide-y p-0">{item.beneficiaries.slice(0, 30).map((b, i) => <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-3"><span className="truncate text-sm font-medium">{b.name}</span><span className="text-xs text-muted-foreground">{b.count} صرفيات</span></div>)}</Card> : <Empty text="لا يوجد مستفيدون بعد" />}
    </DetailSection>

    <DetailSection title="PHIF Supplier" icon={Boxes}>
      <Card className="p-3"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">سعر الشراء الداخلي</p><strong className="mt-1 block">{item.phif.price == null ? "غير محدد" : money(item.phif.price)}</strong><p className="mt-1 text-[11px] text-muted-foreground">{item.phif.unit ? `لكل ${item.phif.unit}` : "السعر لكل وحدة صرف"} · {item.phif.count} صرفية</p></div><Button size="sm" variant="outline" onClick={() => undefined}>تعديل السعر</Button></div></Card>
    </DetailSection>

    <DetailSection title="منتجات Actual" icon={Boxes}>
      {item.actualProducts.length ? <div className="grid gap-2">{item.actualProducts.map((p: any) => <Card key={p.id} className="p-3"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><div className="min-w-0"><h3 className="truncate font-bold" dir="ltr">{p.brand}</h3><p className="mt-0.5 truncate text-xs text-muted-foreground">{p.supplier}</p></div><Badge variant="outline" className="h-fit rounded-md">Actual</Badge></div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs"><div><span className="text-muted-foreground">cost/unit</span><strong className="block break-words">{item.canSeeCost ? money(p.cost) : "محجوب"}</strong></div><div><span className="text-muted-foreground">sale/unit</span><strong className="block break-words">{money(p.sale)}</strong></div><div><span className="text-muted-foreground">المخزون</span><strong className="block">{p.stock == null ? "—" : `${p.stock} ${p.unit}`}</strong></div><div><span className="text-muted-foreground">آخر مزامنة</span><strong className="block">{dateLabel(p.synced)}</strong></div></div></Card>)}</div> : <Empty text="لا توجد منتجات Actual في المخزون الحالي" />}
    </DetailSection>

    <DetailSection title="حركة الصرف" icon={CalendarClock}>
      {item.movements.length ? <Card className="divide-y p-0">{item.movements.map((m: any) => <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"><div className="min-w-0"><strong className="block truncate text-sm">صرف {m.quantity ?? "—"} · {m.beneficiary ?? "—"}</strong><span className="text-xs text-muted-foreground">{m.source}{m.brand ? ` · ${m.brand}` : ""}</span></div><time className="shrink-0 text-xs text-muted-foreground">{dateLabel(m.date)}</time></div>)}</Card> : <Empty text="لا توجد حركة صرف" />}
    </DetailSection>
  </div>;
}
