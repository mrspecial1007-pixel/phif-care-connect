import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPharmacyUser, listPharmacyUsers, listTiryaqPermissions, resetPharmacyUserPassword, updatePharmacyUser } from "@/lib/user-management.functions";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings/users")({
  component: () => <Gate><UsersSettingsPage /></Gate>,
});

type DraftUser = {
  id?: string;
  display_name: string;
  login_identifier: string;
  role: "admin" | "employee";
  is_active: boolean;
  permissions: Record<string, boolean>;
  pin: string;
  pin_confirm: string;
};

type ResetPinState = {
  userId: string;
  displayName: string;
  pin: string;
  pin_confirm: string;
} | null;

const emptyDraft: DraftUser = {
  display_name: "",
  login_identifier: "",
  role: "employee",
  is_active: true,
  permissions: {},
  pin: "",
  pin_confirm: "",
};

function UsersSettingsPage() {
  const qc = useQueryClient();
  const listUsersFn = useServerFn(listPharmacyUsers);
  const listPermissionsFn = useServerFn(listTiryaqPermissions);
  const createFn = useServerFn(createPharmacyUser);
  const updateFn = useServerFn(updatePharmacyUser);
  const resetFn = useServerFn(resetPharmacyUserPassword);
  const [draft, setDraft] = useState<DraftUser>(emptyDraft);
  const [resetPin, setResetPin] = useState<ResetPinState>(null);

  const { data: users, isLoading } = useQuery({ queryKey: ["pharmacy_users"], queryFn: () => listUsersFn() });
  const { data: permissions } = useQuery({ queryKey: ["tiryaq_permissions"], queryFn: () => listPermissionsFn() });
  const permissionEntries = useMemo(() => Object.entries(permissions ?? {}), [permissions]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (draft.id) {
        const { pin, pin_confirm, ...payload } = draft;
        return updateFn({ data: payload as any });
      }
      return createFn({ data: draft as any });
    },
    onSuccess: () => {
      toast.success(draft.id ? "تم حفظ المستخدم" : "تم إنشاء المستخدم");
      setDraft(emptyDraft);
      qc.invalidateQueries({ queryKey: ["pharmacy_users"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر حفظ المستخدم"),
  });

  const resetMutation = useMutation({
    mutationFn: (input: { id: string; pin: string; pin_confirm: string }) => resetFn({ data: input }),
    onSuccess: () => {
      setResetPin(null);
      toast.success("تم حفظ الرقم السري الجديد");
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر حفظ الرقم السري"),
  });

  function setPermission(key: string, value: boolean) {
    setDraft((prev) => ({ ...prev, permissions: { ...prev.permissions, [key]: value } }));
  }

  function editUser(user: any) {
    setDraft({
      id: user.id,
      display_name: user.display_name,
      login_identifier: user.login_identifier,
      role: user.role,
      is_active: user.is_active,
      permissions: user.permissions ?? {},
      pin: "",
      pin_confirm: "",
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">إدارة الموظفين</h1>
        <p className="text-sm text-muted-foreground">إدارة حسابات الترياق وصلاحياتها. لا تُحفظ الأرقام السرية كنص صريح.</p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Input placeholder="اسم الموظف" value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
          <Input placeholder="البريد أو اسم الدخول" value={draft.login_identifier} onChange={(e) => setDraft({ ...draft, login_identifier: e.target.value })} dir="ltr" />
          <Select value={draft.role} onValueChange={(value: any) => setDraft({ ...draft, role: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">مدير</SelectItem>
              <SelectItem value="employee">موظف</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!draft.id && (
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="الرقم السري"
              value={draft.pin}
              onChange={(e) => setDraft({ ...draft, pin: e.target.value })}
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              dir="ltr"
              autoComplete="new-password"
            />
            <Input
              placeholder="تأكيد الرقم السري"
              value={draft.pin_confirm}
              onChange={(e) => setDraft({ ...draft, pin_confirm: e.target.value })}
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              dir="ltr"
              autoComplete="new-password"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Switch checked={draft.is_active} onCheckedChange={(value) => setDraft({ ...draft, is_active: value })} />
          <span className="text-sm">الحساب فعال</span>
        </div>
        <div className={`grid gap-2 md:grid-cols-2 ${draft.role === "admin" ? "opacity-50" : ""}`}>
          {permissionEntries.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <span>{label as string}</span>
              <Switch
                checked={draft.role === "admin" || draft.permissions[key] === true}
                disabled={draft.role === "admin"}
                onCheckedChange={(value) => setPermission(key, value)}
              />
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {draft.id ? "حفظ التعديلات" : "إضافة موظف"}
          </Button>
          {draft.id && <Button variant="outline" onClick={() => setDraft(emptyDraft)}>إلغاء التحرير</Button>}
        </div>
      </Card>

      <div className="grid gap-3">
        {isLoading && <div className="text-muted-foreground">جاري التحميل...</div>}
        {(users ?? []).map((user: any) => (
          <Card key={user.id} className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{user.display_name}</div>
              <div className="text-xs text-muted-foreground" dir="ltr">{user.login_identifier}</div>
              <div className="text-xs text-muted-foreground">{user.role === "admin" ? "مدير" : "موظف"} · {user.is_active ? "فعال" : "معطل"}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => editUser(user)}>تعديل</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResetPin({ userId: user.id, displayName: user.display_name, pin: "", pin_confirm: "" })}
              >
                إعادة تعيين الرقم السري
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!resetPin} onOpenChange={(open) => !open && setResetPin(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>إعادة تعيين الرقم السري</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">{resetPin?.displayName}</div>
            <Input
              placeholder="الرقم السري الجديد"
              value={resetPin?.pin ?? ""}
              onChange={(e) => setResetPin((prev) => prev ? { ...prev, pin: e.target.value } : prev)}
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              dir="ltr"
              autoComplete="new-password"
            />
            <Input
              placeholder="تأكيد الرقم السري"
              value={resetPin?.pin_confirm ?? ""}
              onChange={(e) => setResetPin((prev) => prev ? { ...prev, pin_confirm: e.target.value } : prev)}
              inputMode="numeric"
              pattern="[0-9]*"
              type="password"
              dir="ltr"
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">يجب أن يكون الرقم السري من 4 إلى 8 أرقام.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetPin(null)} disabled={resetMutation.isPending}>إلغاء</Button>
            <Button
              disabled={!resetPin || resetMutation.isPending}
              onClick={() => resetPin && resetMutation.mutate({
                id: resetPin.userId,
                pin: resetPin.pin,
                pin_confirm: resetPin.pin_confirm,
              })}
            >
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
