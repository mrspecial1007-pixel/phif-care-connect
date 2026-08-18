import { createFileRoute, Link } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSmsHistory } from "@/lib/sms.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  MessageSquare, 
  Search, 
  Filter, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Smartphone,
  ChevronLeft,
  Calendar,
  User,
  History
} from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/messages")({
  component: () => <Gate><SmsMessagesPage /></Gate>,
});

function SmsMessagesPage() {
  const [search, setSearch] = useState("");
  const fetchHistory = useServerFn(getSmsHistory);
  
  const { data: messages } = useSuspenseQuery({
    queryKey: ["sms_history"],
    queryFn: () => fetchHistory({ data: {} }),
  });

  const filteredMessages = useMemo(() => {
    if (!messages) return [];
    const s = search.toLowerCase();
    return messages.filter(m => 
      m.phone_number.includes(s) || 
      (m.patients?.patient_name || "").toLowerCase().includes(s) ||
      m.message_body.toLowerCase().includes(s)
    );
  }, [messages, search]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="outline" className="gap-1 bg-slate-100 text-slate-600 border-none"><Clock className="h-3 w-3" /> قيد الانتظار</Badge>;
      case "sending": return <Badge variant="outline" className="gap-1 bg-blue-100 text-blue-600 border-none animate-pulse"><Smartphone className="h-3 w-3" /> جارٍ الإرسال</Badge>;
      case "sent": return <Badge variant="outline" className="gap-1 bg-info/10 text-info border-none"><CheckCircle2 className="h-3 w-3" /> تم الإرسال</Badge>;
      case "delivered": return <Badge variant="outline" className="gap-1 bg-success/10 text-success border-none"><CheckCircle2 className="h-3 w-3" /> تم التسليم</Badge>;
      case "failed": return <Badge variant="destructive" className="gap-1 border-none"><AlertCircle className="h-3 w-3" /> فشل</Badge>;
      case "cancelled": return <Badge variant="outline" className="gap-1 bg-slate-200 text-slate-500 border-none">ملغاة</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6 pb-24 rtl min-h-screen bg-slate-50/50">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20 px-4 py-4 shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-info/10 rounded-lg">
              <MessageSquare className="h-5 w-5 text-info" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">سجل الرسائل SMS</h1>
          </div>
          <Badge variant="secondary" className="font-mono" dir="ltr">{filteredMessages.length}</Badge>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 space-y-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="ابحث بالاسم، الرقم، أو محتوى الرسالة..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 bg-white border-slate-200 rounded-xl h-11"
          />
        </div>

        {/* Message List */}
        <div className="flex flex-col gap-3">
          {filteredMessages.length === 0 ? (
            <div className="text-center py-20 text-slate-400 bg-white rounded-2xl border-2 border-dashed">
              <History className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>لا توجد رسائل مسجلة</p>
            </div>
          ) : (
            filteredMessages.map((m) => (
              <Card key={m.id} className="p-4 bg-white shadow-sm border-none ring-1 ring-slate-200">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-slate-400" />
                        <h3 className="font-bold text-slate-900">{m.patients?.patient_name}</h3>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500" dir="ltr">
                        <Smartphone className="h-3 w-3" />
                        <span>{m.phone_number}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {getStatusBadge(m.current_status)}
                    </div>
                  </div>

                  <div className="bg-slate-50 p-3 rounded-lg text-sm text-slate-700 leading-relaxed text-right whitespace-pre-wrap border border-slate-100">
                    {m.message_body}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      <span>{format(new Date(m.created_at), "yyyy/MM/dd HH:mm", { locale: ar })}</span>
                    </div>
                    {m.sms_send_attempts && m.sms_send_attempts.length > 0 && (
                      <div className="flex items-center gap-1">
                        <History className="h-3 w-3" />
                        <span>{m.sms_send_attempts.length} محاولات</span>
                      </div>
                    )}
                  </div>

                  {m.current_status === "failed" && (
                    <Button variant="outline" size="sm" className="w-full text-xs h-8 gap-2 border-red-100 text-red-600 hover:bg-red-50">
                      إعادة المحاولة
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
