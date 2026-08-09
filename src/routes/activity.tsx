import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { useActivityLogs } from "@/lib/queries";
import { Card } from "@/components/ui/card";
import { 
  UserPlus, 
  UserCog, 
  FileEdit, 
  Trash2, 
  Download, 
  PhoneCall, 
  MessageSquare, 
  Building2, 
  History,
  CalendarDays
} from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/activity")({
  component: () => <Gate><ActivityPage /></Gate>,
});

function getActionIcon(action: string) {
  if (action.includes("اتصال")) return <PhoneCall className="h-4 w-4 text-primary" />;
  if (action.includes("WhatsApp") || action.includes("SMS")) return <MessageSquare className="h-4 w-4 text-success" />;
  if (action.includes("صرف")) return <CalendarDays className="h-4 w-4 text-info" />;
  
  switch (action) {
    case "create_patient": return <UserPlus className="h-4 w-4 text-success" />;
    case "update_patient": return <UserCog className="h-4 w-4 text-warning" />;
    case "import_excel": return <Download className="h-4 w-4 text-info" />;
    case "delete": return <Trash2 className="h-4 w-4 text-destructive" />;
    default: return <History className="h-4 w-4 text-muted-foreground" />;
  }
}

function getActionLabel(action: string) {
  if (action.includes("اتصال")) return "اتصال هاتفي";
  if (action.includes("WhatsApp")) return "مراسلة WhatsApp";
  if (action.includes("SMS")) return "مراسلة SMS";
  if (action.includes("صرف")) return action;

  const labels: Record<string, string> = {
    "create_patient": "إضافة مستفيد",
    "update_patient": "تعديل بيانات مستفيد",
    "import_excel": "استيراد ملف Excel",
    "delete": "حذف بيانات",
  };
  return labels[action] || action;
}

function ActivityPage() {
  const { data: logs, isLoading } = useActivityLogs();
  const [filter, setFilter] = useState<string>("all");

  const filteredLogs = logs?.filter(log => {
    if (filter === "all") return true;
    if (filter === "dispensing") return log.action_type.includes("صرف");
    if (filter === "communication") return log.action_type.includes("اتصال") || log.action_type.includes("WhatsApp") || log.action_type.includes("SMS");
    if (filter === "system") return ["create_patient", "update_patient", "import_excel"].includes(log.action_type);
    return true;
  });

  return (
    <div className="space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">نشاط اليوم</h1>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="تصفية" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">الكل</SelectItem>
            <SelectItem value="dispensing">عمليات الصرف</SelectItem>
            <SelectItem value="communication">التواصل</SelectItem>
            <SelectItem value="system">النظام</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-10 text-muted-foreground">جاري التحميل...</div>
        ) : filteredLogs?.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">لا يوجد نشاط مسجل</div>
        ) : (
          filteredLogs?.map((log) => (
            <Card key={log.id} className="p-4 border-r-4 border-r-primary/20">
              <div className="flex gap-3">
                <div className="mt-1 p-2 bg-muted rounded-full shrink-0">
                  {getActionIcon(log.action_type)}
                </div>
                <div className="space-y-1 grow">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">
                      {getActionLabel(log.action_type)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {format(new Date(log.created_at), "HH:mm - yyyy/MM/dd", { locale: ar })}
                    </span>
                  </div>
                  
                  <div className="text-sm text-foreground/80">
                    {log.details?.patient_name && (
                      <span className="font-medium text-primary ml-1">{log.details.patient_name}</span>
                    )}
                    {log.details?.description || ""}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <Badge variant="outline" className="text-[10px] font-normal py-0">
                      <Building2 className="h-3 w-3 ml-1" />
                      {log.pharmacy_name}
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
