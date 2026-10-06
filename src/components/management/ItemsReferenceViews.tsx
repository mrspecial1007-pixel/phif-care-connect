import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Boxes, CalendarClock, ChevronLeft, Edit3, PackagePlus, Pill, Search, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ReportBackLink } from "./ReportBackLink";

type ItemReference = {
  id: string;
  ingredient: string;
  strength: string;
  form: string;
  beneficiaries: number;
  sources: Array<"Actual" | "PHIF Supplier">;
};

const referenceItems: ItemReference[] = [
  { id: "metformin-500-tablet", ingredient: "Metformin", strength: "500 mg", form: "أقراص", beneficiaries: 30, sources: ["Actual", "PHIF Supplier"] },
  { id: "amlodipine-5-tablet", ingredient: "Amlodipine", strength: "5 mg", form: "أقراص", beneficiaries: 24, sources: ["Actual"] },
  { id: "atorvastatin-20-tablet", ingredient: "Atorvastatin", strength: "20 mg", form: "أقراص", beneficiaries: 18, sources: ["Actual", "PHIF Supplier"] },
  { id: "insulin-glargine-100-injection", ingredient: "Insulin glargine", strength: "100 IU/mL", form: "حقن", beneficiaries: 12, sources: ["PHIF Supplier"] },
  { id: "salbutamol-100-inhaler", ingredient: "Salbutamol", strength: "100 mcg", form: "بخاخ", beneficiaries: 9, sources: ["Actual"] },
];

const actualProducts = [
  { brand: "Glucophage", supplier: "المتحدة للأدوية", cost: "0.38 د.ل / قرص", sale: "0.55 د.ل / قرص", stock: "184 قرص", synced: "اليوم، 10:42 ص" },
  { brand: "Metfor", supplier: "المخزن الطبي", cost: "0.31 د.ل / قرص", sale: "0.48 د.ل / قرص", stock: "96 قرص", synced: "أمس، 4:15 م" },
];

const beneficiaries = ["سالم علي", "فاطمة محمد", "عمر صالح"];
const movements = [
  { date: "6 أكتوبر 2026", label: "صرف 30 قرص", source: "Actual" },
  { date: "2 أكتوبر 2026", label: "صرف 60 قرص", source: "PHIF Supplier" },
  { date: "28 سبتمبر 2026", label: "صرف 30 قرص", source: "Actual" },
];

function SourceBadges({ sources }: { sources: ItemReference["sources"] }) {
  return <div className="flex flex-wrap gap-1.5">{sources.map(source => <Badge key={source} variant={source === "Actual" ? "default" : "secondary"} className="rounded-md px-2 py-0.5 text-[11px] font-medium">{source}</Badge>)}</div>;
}

export function ItemsReferencePage() {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return referenceItems;
    return referenceItems.filter(item => [item.ingredient, item.strength, item.form].some(value => value.toLowerCase().includes(term)));
  }, [search]);

  return <div className="space-y-4" dir="rtl">
    <header className="space-y-3">
      <ReportBackLink to="/management/reports/items" label="الأصناف" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0"><h1 className="text-xl font-bold">الأصناف</h1><p className="mt-1 text-sm text-muted-foreground">مرجع الأدوية مرتب حسب الاسم العلمي</p></div>
        <Button size="sm" className="shrink-0" onClick={() => undefined}><PackagePlus className="size-4" />إضافة صنف</Button>
      </div>
    </header>

    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input aria-label="البحث في الأصناف" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالمادة أو التركيز أو الشكل" className="h-11 pr-10" />
    </div>

    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{filtered.length} أصناف</span><span>بالاسم العلمي</span></div>
    <div className="grid gap-2 sm:grid-cols-2">
      {filtered.map(item => <Link key={item.id} to="/management/reports/items/$itemId" params={{ itemId: item.id }} className="block min-w-0">
        <Card className="p-3 transition-colors hover:bg-accent/40">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0 space-y-2">
              <div><h2 className="truncate font-bold" dir="ltr">{item.ingredient}</h2><p className="mt-0.5 text-sm text-muted-foreground">{item.strength} · {item.form}</p></div>
              <SourceBadges sources={item.sources} />
            </div>
            <div className="flex shrink-0 items-center gap-2"><span className="text-xs font-medium">{item.beneficiaries} مستفيد</span><ChevronLeft className="size-4 text-muted-foreground" /></div>
          </div>
        </Card>
      </Link>)}
      {filtered.length === 0 && <div className="border-y py-8 text-center"><Pill className="mx-auto mb-2 size-6 text-muted-foreground" /><p className="font-medium">لا توجد أصناف مطابقة</p><p className="mt-1 text-xs text-muted-foreground">جرّب اسمًا علميًا أو تركيزًا آخر</p></div>}
    </div>
  </div>;
}

function DetailSection({ title, icon: Icon, children }: { title: string; icon: typeof Pill; children: React.ReactNode }) {
  return <section className="space-y-2"><div className="flex items-center gap-2"><Icon className="size-4 text-primary" /><h2 className="font-bold">{title}</h2></div>{children}</section>;
}

export function ItemReferenceDetailsPage({ itemId }: { itemId: string }) {
  const item = referenceItems.find(entry => entry.id === itemId) ?? referenceItems[0];
  return <div className="space-y-5" dir="rtl">
    <header className="space-y-3">
      <ReportBackLink to="/management/reports" label="مركز التقارير" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0"><p className="text-xs text-muted-foreground">تعريف الصنف العلمي</p><h1 className="truncate text-xl font-bold" dir="ltr">{item.ingredient}</h1><p className="mt-1 text-sm text-muted-foreground">{item.strength} · {item.form}</p></div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => undefined}><Edit3 className="size-4" />تعديل التعريف</Button>
      </div>
      <SourceBadges sources={item.sources} />
    </header>

    <DetailSection title="نظرة عامة" icon={Pill}>
      <div className="grid grid-cols-3 border-y text-center"><div className="p-3"><strong className="block text-base">{item.beneficiaries}</strong><span className="text-[11px] text-muted-foreground">مستفيد</span></div><div className="border-x p-3"><strong className="block text-base">{actualProducts.length}</strong><span className="text-[11px] text-muted-foreground">منتج Actual</span></div><div className="p-3"><strong className="block text-base">2</strong><span className="text-[11px] text-muted-foreground">مصدر</span></div></div>
    </DetailSection>

    <DetailSection title="المستفيدون" icon={Users}>
      <Card className="divide-y p-0">{beneficiaries.map((name, index) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-3"><span className="truncate text-sm font-medium">{name}</span><span className="text-xs text-muted-foreground">{index + 1} صرفيات</span></div>)}</Card>
    </DetailSection>

    <DetailSection title="PHIF Supplier" icon={Boxes}>
      <Card className="p-3"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">سعر الشراء الداخلي</p><strong className="mt-1 block">غير محدد</strong><p className="mt-1 text-[11px] text-muted-foreground">السعر لكل وحدة صرف</p></div><Button size="sm" variant="outline" onClick={() => undefined}>تعديل السعر</Button></div></Card>
    </DetailSection>

    <DetailSection title="منتجات Actual" icon={Boxes}>
      <div className="grid gap-2">{actualProducts.map(product => <Card key={product.brand} className="p-3"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3"><div className="min-w-0"><h3 className="truncate font-bold" dir="ltr">{product.brand}</h3><p className="mt-0.5 text-xs text-muted-foreground">{product.supplier}</p></div><Badge variant="outline" className="h-fit rounded-md">Actual</Badge></div><div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs"><div><span className="text-muted-foreground">cost/unit</span><strong className="block break-words">{product.cost}</strong></div><div><span className="text-muted-foreground">sale/unit</span><strong className="block break-words">{product.sale}</strong></div><div><span className="text-muted-foreground">المخزون</span><strong className="block">{product.stock}</strong></div><div><span className="text-muted-foreground">آخر مزامنة</span><strong className="block">{product.synced}</strong></div></div></Card>)}</div>
    </DetailSection>

    <DetailSection title="حركة الصرف" icon={CalendarClock}>
      <Card className="divide-y p-0">{movements.map(movement => <div key={`${movement.date}-${movement.source}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3"><div className="min-w-0"><strong className="block text-sm">{movement.label}</strong><span className="text-xs text-muted-foreground">{movement.source}</span></div><time className="shrink-0 text-xs text-muted-foreground">{movement.date}</time></div>)}</Card>
    </DetailSection>
  </div>;
}