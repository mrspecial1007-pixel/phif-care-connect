import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { useDispensingTransactions, DispensingTransactionRow, usePharmacies } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { 
  Building2, 
  CalendarDays,
  Search,
  Filter,
  ArrowLeft,
  ArrowRight,
  Download,
  Calendar,
  Clock,
  User,
  CreditCard,
  FileText,
  ChevronLeft,
  ChevronRight,
  History
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, isToday } from "date-fns";
import { ar } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { 
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import ExcelJS from "exceljs";

export const Route = createFileRoute("/activity")({
  component: () => <Gate><DispensingActivityPage /></Gate>,
});

function DispensingActivityPage() {
  const [date, setDate] = useState(new Date());
  const [rangeMode, setRangeMode] = useState(false);
  const [dateRange, setDateRange] = useState<{ from: string, to: string }>({
    from: format(new Date(), "yyyy-MM-dd"),
    to: format(new Date(), "yyyy-MM-dd")
  });
  
  const [pharmacyFilter, setPharmacyFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const queryOptions = useMemo(() => {
    if (rangeMode) {
      return {
        startDate: dateRange.from,
        endDate: dateRange.to,
        pharmacyId: pharmacyFilter,
        type: typeFilter,
        search
      };
    }
    const d = format(date, "yyyy-MM-dd");
    return {
      startDate: d,
      endDate: d,
      pharmacyId: pharmacyFilter,
      type: typeFilter,
      search
    };
  }, [date, rangeMode, dateRange, pharmacyFilter, typeFilter, search]);

  const { data: transactions, isLoading } = useDispensingTransactions(queryOptions);
  const { data: pharmacies } = usePharmacies();

  const sortedTransactions = useMemo(() => {
    if (!transactions) return [];
    return [...transactions].sort((a, b) => {
      const dateA = new Date(a.dispensing_date).getTime();
      const dateB = new Date(b.dispensing_date).getTime();
      return sortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });
  }, [transactions, sortOrder]);

  const stats = useMemo(() => {
    if (!transactions) return null;
    const s = {
      total: transactions.length,
      completed: transactions.filter(t => t.transaction_type === "Completed").length,
      partial: transactions.filter(t => t.transaction_type === "Partial").length,
      remaining: transactions.filter(t => t.transaction_type === "Remaining").length,
      pharmacies: {} as Record<string, number>
    };
    transactions.forEach(t => {
      s.pharmacies[t.pharmacy_name] = (s.pharmacies[t.pharmacy_name] || 0) + 1;
    });
    return s;
  }, [transactions]);

  const handlePrevDay = () => setDate(d => subDays(d, 1));
  const handleNextDay = () => {
    if (isToday(date)) return;
    setDate(d => {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      return next;
    });
  };

  // Removed unused handleExport dependencies or helper functions if any were left outside main body
  // (Main body contains everything needed now)

  const handleExport = async () => {
    if (!transactions || transactions.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("حركات الصرف");

    sheet.columns = [
      { header: "التاريخ", key: "date", width: 15 },
      { header: "الوقت", key: "time", width: 12 },
      { header: "اسم المستفيد", key: "patient_name", width: 30 },
      { header: "رقم البطاقة", key: "card", width: 20 },
      { header: "الصيدلية", key: "pharmacy", width: 20 },
      { header: "نوع الصرف", key: "type", width: 15 },
      { header: "الأصناف المصروفة", key: "items", width: 15 },
      { header: "ملاحظات", key: "notes", width: 40 },
    ];

    transactions.forEach(t => {
      sheet.addRow({
        date: format(new Date(t.dispensing_date), "yyyy/MM/dd"),
        time: format(new Date(t.created_at), "hh:mm a", { locale: ar }),
        patient_name: t.patient_name,
        card: t.insurance_card_number,
        pharmacy: t.pharmacy_name,
        type: t.transaction_type === "Completed" ? "صرف كامل" : t.transaction_type === "Partial" ? "صرف جزئي" : "صرف متبقي",
        items: t.items_dispensed || 0,
        notes: t.notes || "",
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `حركات_الصرف_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    link.click();
    toast.success("تم تصدير الملف بنجاح");
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "Completed": return <Badge className="bg-success hover:bg-success/90">صرف كامل</Badge>;
      case "Partial": return <Badge className="bg-info hover:bg-info/90">صرف جزئي</Badge>;
      case "Remaining": return <Badge className="bg-purple-600 hover:bg-purple-700">صرف متبقي</Badge>;
      default: return <Badge variant="outline">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6 pb-24 rtl min-h-screen bg-slate-50/50">
      {/* Header Area */}
      <div className="bg-white border-b sticky top-0 z-20 px-4 py-4 shadow-sm">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <History className="h-5 w-5 text-primary" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">حركات الصرف</h1>
            </div>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
              <Download className="h-4 w-4" />
              تصدير
            </Button>
          </div>

          {/* Date Navigation */}
          {!rangeMode ? (
            <div className="flex items-center justify-center gap-4 bg-slate-100 p-1 rounded-xl">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handlePrevDay}
                className="hover:bg-white hover:shadow-sm rounded-lg"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
              <div className="flex flex-col items-center min-w-[140px]">
                <span className="text-sm font-bold text-primary">
                  {isToday(date) ? "اليوم" : format(date, "EEEE", { locale: ar })}
                </span>
                <span className="text-xs text-slate-500">
                  {format(date, "dd / MM / yyyy")}
                </span>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleNextDay}
                disabled={isToday(date)}
                className="hover:bg-white hover:shadow-sm rounded-lg disabled:opacity-30"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 mr-1">من تاريخ</label>
                <Input 
                  type="date" 
                  value={dateRange.from} 
                  onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                  className="bg-slate-100 border-none h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 mr-1">إلى تاريخ</label>
                <Input 
                  type="date" 
                  value={dateRange.to} 
                  onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                  className="bg-slate-100 border-none h-9 text-sm"
                />
              </div>
            </div>
          )}

          {/* Quick Date Options */}
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <Button 
              variant={!rangeMode && isToday(date) ? "default" : "secondary"}
              size="sm"
              onClick={() => { setRangeMode(false); setDate(new Date()); }}
              className="whitespace-nowrap rounded-full h-8 text-xs"
            >
              اليوم
            </Button>
            <Button 
              variant={!rangeMode && !isToday(date) && format(date, "yyyy-MM-dd") === format(subDays(new Date(), 1), "yyyy-MM-dd") ? "default" : "secondary"}
              size="sm"
              onClick={() => { setRangeMode(false); setDate(subDays(new Date(), 1)); }}
              className="whitespace-nowrap rounded-full h-8 text-xs"
            >
              أمس
            </Button>
            <Button 
              variant={rangeMode && dateRange.from === format(subDays(new Date(), 7), "yyyy-MM-dd") ? "default" : "secondary"}
              size="sm"
              onClick={() => {
                setRangeMode(true);
                setDateRange({
                  from: format(subDays(new Date(), 7), "yyyy-MM-dd"),
                  to: format(new Date(), "yyyy-MM-dd")
                });
              }}
              className="whitespace-nowrap rounded-full h-8 text-xs"
            >
              آخر 7 أيام
            </Button>
            <Button 
              variant={rangeMode && dateRange.from === format(startOfMonth(new Date()), "yyyy-MM-dd") ? "default" : "secondary"}
              size="sm"
              onClick={() => {
                setRangeMode(true);
                setDateRange({
                  from: format(startOfMonth(new Date()), "yyyy-MM-dd"),
                  to: format(endOfMonth(new Date()), "yyyy-MM-dd")
                });
              }}
              className="whitespace-nowrap rounded-full h-8 text-xs"
            >
              هذا الشهر
            </Button>
            <Button 
              variant={rangeMode && !["اليوم", "أمس", "آخر 7 أيام", "هذا الشهر"].includes("نطاق مخصص") ? "default" : "secondary"}
              size="sm"
              onClick={() => setRangeMode(true)}
              className="whitespace-nowrap rounded-full h-8 text-xs"
            >
              نطاق مخصص
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 space-y-6">
        {/* Summary Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card className="p-3 bg-white shadow-sm border-none ring-1 ring-slate-200">
              <span className="text-[10px] font-bold text-slate-500 block mb-1">إجمالي العمليات</span>
              <span className="text-xl font-black text-primary">{stats.total}</span>
            </Card>
            <Card className="p-3 bg-white shadow-sm border-none ring-1 ring-slate-200">
              <span className="text-[10px] font-bold text-slate-500 block mb-1">صرف كامل</span>
              <span className="text-xl font-black text-success">{stats.completed}</span>
            </Card>
            <Card className="p-3 bg-white shadow-sm border-none ring-1 ring-slate-200">
              <span className="text-[10px] font-bold text-slate-500 block mb-1">صرف جزئي</span>
              <span className="text-xl font-black text-info">{stats.partial}</span>
            </Card>
            {Object.entries(stats.pharmacies).map(([name, count]) => (
              <Card key={name} className="p-3 bg-white shadow-sm border-none ring-1 ring-slate-200">
                <span className="text-[10px] font-bold text-slate-500 block mb-1">{name}</span>
                <span className="text-xl font-black text-slate-700">{count}</span>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2 relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="ابحث بالاسم أو رقم البطاقة..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-9 bg-white border-slate-200 rounded-xl h-11"
            />
          </div>
          <Select value={pharmacyFilter} onValueChange={setPharmacyFilter}>
            <SelectTrigger className="bg-white border-slate-200 rounded-xl h-11">
              <SelectValue placeholder="الصيدلية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الصيدليات</SelectItem>
              {pharmacies?.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="bg-white border-slate-200 rounded-xl h-11">
              <SelectValue placeholder="نوع الصرف" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              <SelectItem value="Completed">صرف كامل</SelectItem>
              <SelectItem value="Partial">صرف جزئي</SelectItem>
              <SelectItem value="Remaining">صرف متبقي</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Sorting Toggle */}
        <div className="flex items-center justify-between text-xs text-slate-500 px-1">
          <span>{sortedTransactions.length} عملية وجُدت</span>
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 text-[10px] font-bold gap-1"
            onClick={() => setSortOrder(prev => prev === "desc" ? "asc" : "desc")}
          >
            <Filter className="h-3 w-3" />
            {sortOrder === "desc" ? "الأحدث أولاً" : "الأقدم أولاً"}
          </Button>
        </div>

        {/* Transaction List */}
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center py-20 text-slate-400">جاري التحميل...</div>
          ) : sortedTransactions.length === 0 ? (
            <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border-2 border-dashed">
              <History className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>لا توجد عمليات صرف مسجلة لهذا التاريخ</p>
            </div>
          ) : (
            sortedTransactions.map((tx) => (
              <Link 
                key={tx.id} 
                to="/patients/$id" 
                params={{ id: tx.patient_id }}
                className="block active:scale-[0.98] transition-transform"
              >
                <Card className="p-4 bg-white shadow-sm hover:shadow-md transition-shadow border-none ring-1 ring-slate-200 group relative overflow-hidden">
                  <div className="flex gap-4">
                    {/* Time Column */}
                    <div className="flex flex-col items-center justify-center shrink-0 w-16 border-l border-slate-100 pl-4">
                      <span className="text-xs font-bold text-primary">
                        {format(new Date(tx.created_at), "hh:mm", { locale: ar })}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        {format(new Date(tx.created_at), "a", { locale: ar })}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="grow space-y-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-bold text-slate-900 leading-tight group-hover:text-primary transition-colors">
                            {tx.patient_name}
                          </h3>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium mt-1">
                            <CreditCard className="h-3 w-3" />
                            <span className="tracking-wider">{tx.insurance_card_number}</span>
                          </div>
                        </div>
                        {getTypeBadge(tx.transaction_type)}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 bg-slate-50 px-2 py-1 rounded-md">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          {tx.pharmacy_name}
                        </div>
                        {tx.notes && (
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-600 bg-amber-50 px-2 py-1 rounded-md max-w-xs truncate">
                            <FileText className="h-3 w-3 text-amber-500" />
                            {tx.notes}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
