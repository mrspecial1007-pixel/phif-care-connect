import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { exportAllData } from "@/lib/activity.functions";
import { Download, Database } from "lucide-react";
import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { useSession } from "@/lib/queries";
import { Bell, Shield, Clock, Send, Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  saveSubscription,
  getSubscriptionSettings,
  updateSubscriptionSettings,
  deleteSubscription,
  sendTestNotification
} from "@/lib/notifications/notifications.functions";

export const Route = createFileRoute("/settings")({
  component: () => <Gate><SettingsPage /></Gate>,
});

function SettingsPage() {
  const exportFn = useServerFn(exportAllData);
  const [busy, setBusy] = useState(false);

  async function fullBackup() {
    setBusy(true);
    try {
      const data: any = await exportFn();
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.patients), "Patients");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.cycles), "Cycles");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
        (data.transactions ?? []).map((t: any) => ({
          ...t,
          patient_name: t.patients?.patient_name,
          pharmacy_name: t.pharmacies?.name,
          patients: undefined,
          pharmacies: undefined,
        })),
      ), "Transactions");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.audit), "Audit");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.pharmacies), "Pharmacies");
      XLSX.writeFile(wb, `phif-backup-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("تم تنزيل النسخة الاحتياطية");
    } catch {
      toast.error("تعذر تصدير البيانات");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">الإعدادات</h1>
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold">تصدير قاعدة البيانات كاملة</div>
            <div className="text-xs text-muted-foreground">المستفيدون والصرف والسجل بصيغة Excel</div>
          </div>
        </div>
        <Button onClick={fullBackup} disabled={busy} className="w-full h-11">
          <Download className="h-4 w-4 ml-2" />
          {busy ? "جاري التحضير…" : "تنزيل النسخة الاحتياطية"}
        </Button>
      </Card>

      <PharmacySettingsCard />
      <NotificationSettingsCard />
    </div>
  );
}

function NotificationSettingsCard() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [subscriptionId, setSubscriptionId] = useState<string | null>(
    typeof localStorage !== 'undefined' ? localStorage.getItem('push_subscription_id') : null
  );
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveSubFn = useServerFn(saveSubscription);
  const getSettingsFn = useServerFn(getSubscriptionSettings);
  const updateSettingsFn = useServerFn(updateSubscriptionSettings);
  const deleteSubFn = useServerFn(deleteSubscription);
  const testPushFn = useServerFn(sendTestNotification);

  useEffect(() => {
    if (subscriptionId) {
      loadSettings(subscriptionId);
    }
  }, [subscriptionId]);

  async function loadSettings(id: string) {
    setLoading(true);
    try {
      const data = await getSettingsFn({ data: { subscriptionId: id } });
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings', err);
      // If not found, clear ID
      setSubscriptionId(null);
      localStorage.removeItem('push_subscription_id');
    } finally {
      setLoading(false);
    }
  }

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast.error("الإشعارات غير مدعومة على هذا الجهاز");
      return;
    }

    setLoading(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);

      if (perm === 'granted') {
        const registration = await navigator.serviceWorker.ready;
        
        // Use placeholder public key or fetch from server if possible
        const VAPID_PUBLIC_KEY = 'BCR5TfX7E8Jk0kH0gZ9_6mB2q5p5L9yX5TjX7E8Jk0kH0gZ9_6mB2q5p5L9yX5Tj';
        
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: VAPID_PUBLIC_KEY
        });

        const res = await saveSubFn({
          data: {
            subscription: subscription,
            userAgent: navigator.userAgent
          }
        });

        if (res.ok) {
          setSubscriptionId(res.id);
          localStorage.setItem('push_subscription_id', res.id);
          toast.success("تم تفعيل إشعارات الهاتف");
        }
      } else {
        toast.error("تم رفض إذن الإشعارات");
      }
    } catch (err) {
      console.error('Push setup failed', err);
      toast.error("فشل تفعيل الإشعارات");
    } finally {
      setLoading(false);
    }
  }

  async function saveAllSettings() {
    if (!subscriptionId || !settings) return;
    setSaving(true);
    try {
      // Exclude read-only fields
      const { id, pharmacy_id, created_at, updated_at, subscription_json, ...updatable } = settings;
      await updateSettingsFn({ data: { id: subscriptionId, settings: updatable } });
      toast.success("تم حفظ إعدادات الإشعارات");
    } catch (err) {
      toast.error("فشل حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!subscriptionId) return;
    try {
      await testPushFn({ data: { subscriptionId } });
      toast.success("تم إرسال إشعار تجريبي");
    } catch (err) {
      toast.error("فشل إرسال الإشعار التجريبي");
    }
  }

  async function disableThisDevice() {
    if (!subscriptionId) return;
    if (!confirm("هل أنت متأكد من إلغاء الإشعارات لهذا الجهاز؟")) return;
    
    try {
      await deleteSubFn({ data: { id: subscriptionId } });
      setSubscriptionId(null);
      setSettings(null);
      localStorage.removeItem('push_subscription_id');
      toast.success("تم إلغاء الإشعارات لهذا الجهاز");
    } catch (err) {
      toast.error("فشل إلغاء الإشعارات");
    }
  }

  if (typeof Notification === 'undefined') {
    return (
      <Card className="p-4 bg-muted/50">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <div className="text-sm">الإشعارات غير مدعومة في هذا المتصفح</div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-6">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-lg">إعدادات الإشعارات</h2>
        </div>
        {subscriptionId && (
          <Button variant="ghost" size="sm" className="text-destructive h-8" onClick={disableThisDevice}>
            <Trash2 className="h-4 w-4 ml-1" />
            إلغاء هذا الجهاز
          </Button>
        )}
      </div>

      {!subscriptionId ? (
        <div className="space-y-4">
          <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
            <p className="text-sm text-center mb-4">ستصلك تنبيهات بمواعيد الصرف المهمة على هذا الجهاز.</p>
            <Button onClick={enablePush} disabled={loading} className="w-full h-11">
              <Shield className="h-4 w-4 ml-2" />
              {loading ? "جاري التفعيل..." : "تفعيل إشعارات الهاتف"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground text-center">
            {permission === 'denied' && "الإشعارات غير مفعلة (مرفوضة من المتصفح)"}
            {permission === 'default' && "الإشعارات لم تطلب بعد"}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between p-3 bg-success/10 rounded-lg border border-success/20">
            <div className="flex items-center gap-2 text-success font-medium">
              <div className="h-2 w-2 rounded-full bg-success animate-pulse" />
              الإشعارات مفعلة على هذا الجهاز
            </div>
            <Button size="sm" variant="outline" onClick={sendTest} className="h-8">
              <Send className="h-3.5 w-3.5 ml-1.5" />
              إشعار تجريبي
            </Button>
          </div>

          {settings && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <Label htmlFor="master-toggle" className="font-bold text-base">تفعيل الإشعارات</Label>
                <Switch 
                  id="master-toggle" 
                  checked={settings.notifications_enabled}
                  onCheckedChange={(val) => setSettings({...settings, notifications_enabled: val})}
                />
              </div>

              <div className={`space-y-4 transition-opacity ${settings.notifications_enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                <NotificationTypeRow 
                  label="ملخص الصباح"
                  description="يومياً، يجمع كل المواعيد"
                  enabled={settings.morning_summary_enabled}
                  time={settings.morning_summary_time}
                  onEnabledChange={(v) => setSettings({...settings, morning_summary_enabled: v})}
                  onTimeChange={(v) => setSettings({...settings, morning_summary_time: v})}
                />
                <NotificationTypeRow 
                  label="مستحقون اليوم"
                  description="تنبيه بمجرد حلول موعد الصرف"
                  enabled={settings.due_today_enabled}
                  time={settings.due_today_time}
                  onEnabledChange={(v) => setSettings({...settings, due_today_enabled: v})}
                  onTimeChange={(v) => setSettings({...settings, due_today_time: v})}
                />
                <NotificationTypeRow 
                  label="مستحقون غدًا"
                  description="تنبيه مسبق للمستحقين غداً"
                  enabled={settings.due_tomorrow_enabled}
                  time={settings.due_tomorrow_time}
                  onEnabledChange={(v) => setSettings({...settings, due_tomorrow_enabled: v})}
                  onTimeChange={(v) => setSettings({...settings, due_tomorrow_time: v})}
                />
                <NotificationTypeRow 
                  label="متأخر يوم أو يومين"
                  description="تنبيه للمتأخرين فقط لأول يومين"
                  enabled={settings.overdue_enabled}
                  time={settings.overdue_time}
                  onEnabledChange={(v) => setSettings({...settings, overdue_enabled: v})}
                  onTimeChange={(v) => setSettings({...settings, overdue_time: v})}
                />
                <NotificationTypeRow 
                  label="صرف جزئي"
                  description="متابعة حالات الصرف غير المكتملة"
                  enabled={settings.partial_enabled}
                  time={settings.partial_time}
                  onEnabledChange={(v) => setSettings({...settings, partial_enabled: v})}
                  onTimeChange={(v) => setSettings({...settings, partial_time: v})}
                />

                <div className="pt-4 border-t space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <Label htmlFor="quiet-toggle" className="font-semibold">ساعات عدم الإزعاج</Label>
                    </div>
                    <Switch 
                      id="quiet-toggle" 
                      checked={settings.quiet_hours_enabled}
                      onCheckedChange={(val) => setSettings({...settings, quiet_hours_enabled: val})}
                    />
                  </div>
                  
                  {settings.quiet_hours_enabled && (
                    <div className="flex items-center gap-4 pr-6">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-xs text-muted-foreground">من:</span>
                        <Input 
                          type="time" 
                          value={settings.quiet_hours_start.slice(0, 5)}
                          onChange={(e) => setSettings({...settings, quiet_hours_start: e.target.value})}
                          className="h-8 py-1 px-2"
                        />
                      </div>
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-xs text-muted-foreground">إلى:</span>
                        <Input 
                          type="time" 
                          value={settings.quiet_hours_end.slice(0, 5)}
                          onChange={(e) => setSettings({...settings, quiet_hours_end: e.target.value})}
                          className="h-8 py-1 px-2"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Button onClick={saveAllSettings} disabled={saving} className="w-full h-11 bg-success hover:bg-success/90">
                {saving ? "جاري الحفظ..." : "حفظ إعدادات الإشعارات"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function NotificationTypeRow({ label, description, enabled, time, onEnabledChange, onTimeChange }: any) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
        {enabled && (
          <div className="mt-1 flex items-center gap-1.5 text-[10px] text-primary/70 font-medium">
             — يومياً الساعة {time.slice(0, 5)}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
        {enabled && (
          <Input 
            type="time" 
            value={time.slice(0, 5)} 
            onChange={(e) => onTimeChange(e.target.value)}
            className="h-7 w-20 text-[11px] p-1"
          />
        )}
      </div>
    </div>
  );
}

function PharmacySettingsCard() {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);
  
  if (!session?.unlocked || !session.pharmacy) return null;
  
  const pharmacy = session.pharmacy as any;

  async function updatePharmacyInfo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;
    const address = formData.get("address") as string;
    const phone = formData.get("phone") as string;

    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase
        .from("pharmacies")
        .update({ name, address, phone })
        .eq("id", pharmacy.id);
      
      if (error) throw error;
      toast.success("تم تحديث بيانات الصيدلية");
      window.location.reload(); // Refresh to update session data
    } catch (err) {
      toast.error("تعذر تحديث البيانات");
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="font-semibold text-lg border-b pb-2">إعدادات الصيدلية الحالية</div>
      <form onSubmit={updatePharmacyInfo} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">اسم الصيدلية</label>
          <input 
            name="name"
            defaultValue={pharmacy.name}
            className="w-full p-2 border rounded-md text-right"
            required
            dir="rtl"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">العنوان (يظهر في الرسائل)</label>
          <textarea 
            name="address"
            defaultValue={pharmacy.address}
            className="w-full p-2 border rounded-md text-right min-h-[80px]"
            required
            dir="rtl"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">رقم الهاتف (اختياري)</label>
          <input 
            name="phone"
            defaultValue={pharmacy.phone}
            className="w-full p-2 border rounded-md text-right"
            dir="ltr"
          />
        </div>
        <Button type="submit" disabled={busy} className="w-full h-11 bg-success hover:bg-success/90">
          {busy ? "جاري الحفظ..." : "حفظ التعديلات"}
        </Button>
      </form>
    </Card>
  );
}
