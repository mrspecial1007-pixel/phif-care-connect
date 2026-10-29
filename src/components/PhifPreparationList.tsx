import { useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ClipboardList, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { groupPreparationItems, preparationNumber, preparationUnitLabel, preparationEstimatedBoxes, preparationTotalLabel, type PreparationPatient } from "@/lib/phif-preparation-list.helpers";
import type { PhifPreparationSummary } from "@/lib/phif-preparation.helpers";
import { normalizeText } from "@/lib/medication-normalize";

type Props = {
  rows: (PreparationPatient & { phif_preparation_issue?: string | null })[];
  preparation: Map<string, PhifPreparationSummary>; from: string; to: string;
};

export function PhifPreparationList({ rows, preparation, from, to }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const report = useMemo(() => groupPreparationItems(rows, preparation), [rows, preparation]);
  const selected = report.groups.find(g => g.key === selectedKey);
  const matches = report.groups.filter(g => normalizeText([g.name, g.strength, g.form].join(" ")).includes(normalizeText(query)));
  const issue = rows.find(row => row.phif_preparation_issue)?.phif_preparation_issue;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setSelectedKey(null); setQuery(""); } }}>
    <DialogTrigger asChild>
      <Button variant="link" className="h-auto gap-1.5 whitespace-normal p-0 text-sm" aria-label={`عدد الأصناف للتجهيز: ${report.originalCount}`}>
        <ClipboardList className="size-4 shrink-0" />{report.originalCount} صنف للتجهيز
      </Button>
    </DialogTrigger>
    <DialogContent dir="rtl" className="flex max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden rounded-lg p-0">
      <DialogHeader className="shrink-0 border-b px-12 py-4 text-right sm:text-right">
        <DialogTitle className="text-base leading-6 tracking-normal">قائمة أدوية التجهيز</DialogTitle>
        <DialogDescription className="text-xs leading-5">{from === to ? from : `${from} - ${to}`} · تقديري بناءً على آخر صرف، وليس احتياجًا مؤكدًا</DialogDescription>
      </DialogHeader>
      <div className="shrink-0 space-y-3 border-b px-4 py-3">
        <p className="text-sm"><strong>{report.originalCount}</strong> صنف مستحق · <strong>{report.groups.length}</strong> صنف مختلف بعد التجميع</p>
        {report.missingCount > 0 && <p role="status" className="text-xs text-amber-800">تفاصيل {report.missingCount} صنف غير متاحة في النتائج المحمّلة؛ يلزم تحديث بيانات المستفيدين.</p>}
        {issue && <p role="status" className="text-xs text-amber-800">{issue}</p>}
        {selected ? <Button variant="ghost" size="sm" className="gap-1 px-0" onClick={() => setSelectedKey(null)}>
          <ArrowRight className="size-4" />العودة إلى الأصناف
        </Button> : <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-3 size-4 text-muted-foreground" />
          <Input aria-label="بحث في أدوية التجهيز" placeholder="بحث باسم الدواء أو التركيز..." value={query} onChange={e => setQuery(e.target.value)} className="pr-9" />
        </div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
        {selected ? <section aria-label="المستفيدون المطلوب تجهيز الصنف لهم" className="min-w-0">
          <div className="border-b py-3">
            <h2 className="break-words text-base font-bold"><bdi>{selected.name}</bdi></h2>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><bdi>{selected.strength}</bdi><span>{selected.form || "الشكل يحتاج تحديدًا"}</span></div>
            <p className="mt-2 text-sm">{selected.beneficiaries.length} مستفيد</p>
            <p className="mt-1 text-lg font-bold text-teal-800">{preparationTotalLabel(selected)}</p>
            {selected.unresolvedCount > 0 && <p className="mt-1 text-xs text-amber-800">كمية {selected.unresolvedCount} حالة تحتاج تحديدًا؛ الإجمالي يشمل الكميات المعروفة فقط.</p>}
          </div>
          <ul className="divide-y">
            {selected.beneficiaries.map(person => <li key={person.key} className="min-w-0 space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="break-words text-sm font-semibold">{person.name}</h3>
                  <p className="mt-1 break-all text-xs text-muted-foreground">البطاقة: <bdi dir="ltr">{person.card || "غير مسجلة"}</bdi></p>
                </div>
                <span className="max-w-36 text-base font-bold text-teal-800">{preparationTotalLabel(person)}</span>
              </div>
              {person.items.map(item => {
                const estimate = preparationEstimatedBoxes(item);
                return <div key={`${item.id}:${item.dueDate}:${item.sourceItemIds.join(":")}`} className="space-y-1 text-xs text-muted-foreground">
                <p>التجهيز التقديري: {estimate.boxes === null ? "يحتاج تحديد" : `${preparationNumber(estimate.boxes)} علبة`}</p>
                {estimate.issue && <p className="text-amber-800">{estimate.issue}</p>}
                <p>آخر كمية صرف مسجلة: {item.quantity === null ? "غير محدد" : `${preparationNumber(item.quantity)} ${preparationUnitLabel(item.quantityUnit)}`}</p>
                {item.packageSize !== null && <p>عبوة آخر صرف: {item.packageSize} {preparationUnitLabel(item.packageUnit)}</p>}
                <p>الاستحقاق: <bdi>{item.dueDate}</bdi>{item.latestDate && <> · آخر صرف: <bdi>{item.latestDate}</bdi></>}</p>
                <p className="text-amber-800">{item.lastDispensingPartial
                  ? "فاتورة آخر صرف مسجلة كصرف جزئي؛ التقدير لا يمثل كامل الاحتياج."
                  : "اكتمال آخر صرف غير مؤكد؛ قد تكون الكمية جزئية ولا تمثل كامل الاحتياج."}</p>
              </div>; })}
            </li>)}
          </ul>
        </section> : <>
          <ul className="divide-y" aria-label="الأدوية المجمعة للتجهيز">
            {matches.map(group => <li key={group.key}>
              <button type="button" onClick={() => setSelectedKey(group.key)} className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold leading-6"><bdi>{group.name}</bdi></h2>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground"><bdi>{group.strength || "التركيز يحتاج تحديدًا"}</bdi><span>{group.form || "الشكل يحتاج تحديدًا"}</span></div>
                  <p className="mt-1 text-xs">{group.beneficiaries.length} مستفيد · {group.itemCount} صنف مستحق</p>
                </div>
                <div className="flex max-w-32 items-center gap-1 text-teal-800">
                  <div className="text-left text-lg font-bold leading-6">{preparationTotalLabel(group)}
                    {group.unresolvedCount > 0 && <p className="mt-1 text-xs font-normal text-muted-foreground">{group.unresolvedCount} كمية تحتاج تحديدًا</p>}
                    {group.partialCount > 0 && <p className="mt-1 text-xs font-normal text-amber-800">{group.partialCount} حالة بفواتير صرف جزئي</p>}
                  </div><ChevronLeft className="size-4 shrink-0" />
                </div>
              </button>
            </li>)}
          </ul>
          {!matches.length && <p role="status" className="py-8 text-center text-sm text-muted-foreground">{query ? "لا توجد أصناف مطابقة للبحث" : "لا توجد تفاصيل أصناف متاحة ضمن النتائج الحالية"}</p>}
        </>}
      </div>
    </DialogContent>
  </Dialog>;
}
