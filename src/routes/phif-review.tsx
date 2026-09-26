import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Gate } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  createPatientFromPhifInvoice,
  linkPhifInvoicesToPatient,
  listPhifReviewCases,
  rejectPhifReviewCase,
  reopenPhifReviewCase,
  searchPhifLinkPatients,
  type PhifInvoiceReviewCase,
} from "@/lib/phif-invoices.functions";
import { AlertTriangle, Loader2, RotateCcw, Search, UserPlus, UserRoundCheck, XCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/phif-review")({
  component: () => (
    <Gate>
      <PhifReviewPage />
    </Gate>
  ),
});

function PhifReviewPage() {
  const listCases = useServerFn(listPhifReviewCases);
  const [search, setSearch] = useState("");
  const [includeRejected, setIncludeRejected] = useState(false);
  const filters = useMemo(() => ({ search: search.trim() || undefined, includeRejected }), [search, includeRejected]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["phif_review_cases", filters],
    queryFn: () => listCases({ data: filters }),
    staleTime: 15_000,
  });

  return (
    <div className="space-y-4 pb-20" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">مراجعة فواتير PHIF</h1>
          <p className="text-sm text-muted-foreground">
            حالات الفواتير غير المطابقة مجمعة حسب رقم بطاقة التأمين.
          </p>
        </div>
        <Badge variant="secondary">{data?.total ?? 0} حالة</Badge>
      </div>

      <Card className="p-3 space-y-3">
        <label className="relative block">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث برقم البطاقة أو اسم المستفيد"
            className="h-11 pr-9"
          />
        </label>
        <Button
          variant={includeRejected ? "default" : "outline"}
          size="sm"
          onClick={() => setIncludeRejected((value) => !value)}
        >
          عرض الحالات المرفوضة
        </Button>
      </Card>

      {isLoading ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin" />
          جاري تحميل حالات المراجعة...
        </Card>
      ) : error ? (
        <Card className="p-6 text-center text-destructive">
          تعذر تحميل قائمة المراجعة. {(error as Error).message}
        </Card>
      ) : (data?.cases?.length ?? 0) === 0 ? (
        <Card className="p-10 text-center text-muted-foreground border-dashed">
          لا توجد حالات مراجعة مطابقة للبحث الحالي.
        </Card>
      ) : (
        <div className="grid gap-3">
          {data!.cases.map((reviewCase) => (
            <ReviewCaseCard key={reviewCase.insurance_card_number} reviewCase={reviewCase} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCaseCard({ reviewCase }: { reviewCase: PhifInvoiceReviewCase }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const reopenCase = useServerFn(reopenPhifReviewCase);
  const qc = useQueryClient();
  const reopenMutation = useMutation({
    mutationFn: () => reopenCase({ data: { insurance_card_number: reviewCase.insurance_card_number } }),
    onSuccess: async () => {
      toast.success("تمت إعادة فتح الحالة");
      await qc.invalidateQueries({ queryKey: ["phif_review_cases"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold">{reviewCase.beneficiary_name || "مستفيد غير معروف"}</div>
            <Badge variant={reviewCase.review_status === "rejected" ? "outline" : "secondary"}>
              {reviewCase.review_status === "rejected" ? "مرفوض" : "قيد المراجعة"}
            </Badge>
          </div>
          <div className="mt-1 text-sm text-muted-foreground" dir="ltr">
            {reviewCase.insurance_card_number}
          </div>
          <div className="text-xs text-muted-foreground">
            {reviewCase.invoice_count} فاتورة محفوظة، آخر تاريخ: {formatDate(reviewCase.latest_dispensing_date)}
          </div>
        </div>
        {reviewCase.review_status === "rejected" ? (
          <Button variant="outline" className="gap-2" onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}>
            {reopenMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            إعادة فتح
          </Button>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button className="gap-2" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-4 w-4" />
              إضافة مستفيد
            </Button>
            <Button variant="outline" className="gap-2" onClick={() => setLinkOpen(true)}>
              <UserRoundCheck className="h-4 w-4" />
              ربط بمستفيد موجود
            </Button>
            <Button variant="ghost" className="gap-2 text-destructive hover:text-destructive" onClick={() => setRejectOpen(true)}>
              <XCircle className="h-4 w-4" />
              رفض
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-2">
        {reviewCase.invoices.slice(0, 4).map((invoice) => (
          <Link key={invoice.id} to="/phif-invoices/$id" params={{ id: invoice.id }} className="rounded-md border p-2 text-sm hover:bg-accent/50">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{invoice.invoice_number || invoice.invoice_key}</span>
              <span className="text-muted-foreground">{formatDate(invoice.dispensing_date)}</span>
            </div>
          </Link>
        ))}
        {reviewCase.invoices.length > 4 && (
          <div className="text-xs text-muted-foreground">+{reviewCase.invoices.length - 4} فواتير أخرى لنفس البطاقة</div>
        )}
      </div>

      <CreatePatientDialog open={createOpen} onOpenChange={setCreateOpen} reviewCase={reviewCase} />
      <LinkPatientDialog open={linkOpen} onOpenChange={setLinkOpen} reviewCase={reviewCase} />
      <RejectCaseDialog open={rejectOpen} onOpenChange={setRejectOpen} reviewCase={reviewCase} />
    </Card>
  );
}

function CreatePatientDialog({
  open,
  onOpenChange,
  reviewCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewCase: PhifInvoiceReviewCase;
}) {
  const [name, setName] = useState(reviewCase.beneficiary_name ?? "");
  const [confirmExistingPatient, setConfirmExistingPatient] = useState(false);
  const createPatient = useServerFn(createPatientFromPhifInvoice);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      createPatient({
        data: {
          insurance_card_number: reviewCase.insurance_card_number,
          patient_name: name.trim() || reviewCase.beneficiary_name || undefined,
          confirm_existing_patient: confirmExistingPatient,
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok && result.needs_existing_patient_confirmation) {
        setConfirmExistingPatient(true);
        toast.warning(result.message);
        return;
      }
      if (!result.ok && result.needs_review) {
        toast.error(result.message);
        return;
      }
      toast.success(result.matched === "existing_added_to_pharmacy" ? "تمت إضافة المستفيد الحالي إلى الترياق وربط الفواتير" : "تم إنشاء المستفيد وربط الفواتير");
      onOpenChange(false);
      setConfirmExistingPatient(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["phif_review_cases"] }),
        qc.invalidateQueries({ queryKey: ["phif_invoices_archive"] }),
        qc.invalidateQueries({ queryKey: ["patient_status"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إضافة مستفيد من فاتورة PHIF</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            سيتم إنشاء مستفيد جديد برقم البطاقة <span dir="ltr">{reviewCase.insurance_card_number}</span> وربط جميع فواتير هذه البطاقة به.
          </div>
          {confirmExistingPatient && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              رقم البطاقة مسجل مسبقًا لهوية مستفيد موجودة. أكد إضافة هذه الهوية إلى صيدلية الترياق دون إنشاء مستفيد جديد ودون كشف بيانات الصيدلية الأخرى.
            </div>
          )}
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="اسم المستفيد" />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="gap-2">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmExistingPatient ? "تأكيد إضافة المستفيد الحالي" : "تأكيد الإضافة"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LinkPatientDialog({
  open,
  onOpenChange,
  reviewCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewCase: PhifInvoiceReviewCase;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const searchPatients = useServerFn(searchPhifLinkPatients);
  const linkPatient = useServerFn(linkPhifInvoicesToPatient);
  const qc = useQueryClient();
  useEffect(() => {
    if (!open) return;
    setSearch(reviewCase.beneficiary_name ?? "");
    setSelected(null);
    setConfirmMismatch(false);
  }, [open, reviewCase.beneficiary_name]);
  const { data: patients, isFetching } = useQuery({
    enabled: open && search.trim().length > 0,
    queryKey: ["phif_link_patients", search],
    queryFn: () => searchPatients({ data: { search } }),
  });
  const mutation = useMutation({
    mutationFn: () =>
      linkPatient({
        data: {
          insurance_card_number: reviewCase.insurance_card_number,
          patient_id: selected.id,
          confirm_card_mismatch: confirmMismatch,
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok && result.needs_confirmation) {
        setConfirmMismatch(true);
        toast.warning(result.message);
        return;
      }
      toast.success("تم ربط الفواتير بالمستفيد");
      onOpenChange(false);
      setSelected(null);
      setConfirmMismatch(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["phif_review_cases"] }),
        qc.invalidateQueries({ queryKey: ["phif_invoices_archive"] }),
        qc.invalidateQueries({ queryKey: ["patient_phif_invoices"] }),
      ]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ربط بمستفيد موجود</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {reviewCase.beneficiary_name && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              تظهر النتائج بالاسم المقترح من الفاتورة فقط. اختر المستفيد يدويًا ولا يتم الربط اعتمادًا على تشابه الاسم وحده.
            </div>
          )}
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المستفيد أو رقم البطاقة" />
          {isFetching && <div className="text-sm text-muted-foreground">جاري البحث...</div>}
          <div className="grid gap-2 max-h-64 overflow-auto">
            {(patients ?? []).map((patient: any) => (
              <button
                key={patient.id}
                type="button"
                onClick={() => {
                  setSelected(patient);
                  setConfirmMismatch(false);
                }}
                className={`rounded-md border p-2 text-right text-sm ${selected?.id === patient.id ? "border-primary bg-primary/5" : ""}`}
              >
                <div className="font-medium">{patient.patient_name}</div>
                <div className="text-xs text-muted-foreground" dir="ltr">{patient.insurance_card_number || "بدون رقم بطاقة"}</div>
              </button>
            ))}
          </div>
          {selected && selected.insurance_card_number !== reviewCase.insurance_card_number && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                رقم بطاقة المستفيد مختلف عن رقم بطاقة الفاتورة.
              </div>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={confirmMismatch} onChange={(event) => setConfirmMismatch(event.target.checked)} />
                أكد الربط دون تعديل رقم بطاقة المستفيد.
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={() => mutation.mutate()} disabled={!selected || mutation.isPending} className="gap-2">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            ربط الفواتير
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RejectCaseDialog({
  open,
  onOpenChange,
  reviewCase,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewCase: PhifInvoiceReviewCase;
}) {
  const rejectCase = useServerFn(rejectPhifReviewCase);
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => rejectCase({ data: { insurance_card_number: reviewCase.insurance_card_number } }),
    onSuccess: async () => {
      toast.success("تم رفض الحالة");
      onOpenChange(false);
      await qc.invalidateQueries({ queryKey: ["phif_review_cases"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>رفض حالة المراجعة</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          سيتم استبعاد هذه الحالة من قائمة المراجعة دون حذف الفواتير. يمكن إعادة فتحها لاحقًا من خيار عرض الحالات المرفوضة.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending} className="gap-2">
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            تأكيد الرفض
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value: string | null) {
  if (!value) return "غير متوفر";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-GB");
}
