import { createFileRoute } from "@tanstack/react-router";
import { Gate } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
};

const emptyDraft: DraftUser = {
  display_name: "",
  login_identifier: "",
  role: "employee",
  is_active: true,
  permissions: {},
};

function UsersSettingsPage() {
  const qc = useQueryClient();
  const listUsersFn = useServerFn(listPharmacyUsers);
  const listPermissionsFn = useServerFn(listTiryaqPermissions);
  const createFn = useServerFn(createPharmacyUser);
  const updateFn = useServerFn(updatePharmacyUser);
  const resetFn = useServerFn(resetPharmacyUserPassword);
  const [draft, setDraft] = useState<DraftUser>(emptyDraft);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({ queryKey: ["pharmacy_users"], queryFn: () => listUsersFn() });
  const { data: permissions } = useQuery({ queryKey: ["tiryaq_permissions"], queryFn: () => listPermissionsFn() });
  const permissionEntries = useMemo(() => Object.entries(permissions ?? {}), [permissions]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (draft.id) return updateFn({ data: draft as any });
      return createFn({ data: draft as any });
    },
    onSuccess: (result: any) => {
      if (result?.temporary_password) setTemporaryPassword(result.temporary_password);
      toast.success(draft.id ? "تم حفظ المستخدم" : "تم إنشاء المستخدم");
      setDraft(emptyDraft);
      qc.invalidateQueries({ queryKey: ["pharmacy_users"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر حفظ المستخدم"),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) => resetFn({ data: { id } }),
    onSuccess: (result: any) => {
      setTemporaryPassword(result.temporary_password);
      toast.success("تمت إعادة تعيين كلمة المرور");
    },
    onError: (error: any) => toast.error(error?.message ?? "تعذر إعادة تعيين كلمة المرور"),
  });

  function setPermission(key: string, value: boolean) {
    setDraft((prev) => ({ ...prev, permissions: { ...prev.permissions, [key]: value } }));
  }

  function editUser(user: any) {
    setTemporaryPassword(null);
    setDraft({
      id: user.id,
      display_name: user.display_name,
      login_identifier: user.login_identifier,
      role: user.role,
      is_active: user.is_active,
      permissions: user.permissions ?? {},
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">إدارة الموظفين</h1>
        <p className="text-sm text-muted-foreground">إدارة حسابات الترياق وصلاحياتها. لا تُحفظ كلمات المرور كنص صريح.</p>
      </div>

      {temporaryPassword && (
        <Card className="p-4 bg-emerald-50 border-emerald-200 space-y-2">
          <div className="font-semibold text-emerald-900">كلمة المرور المؤقتة</div>
          <div className="font-mono text-lg break-all" dir="ltr">{temporaryPassword}</div>
          <Button type="button" variant="outline" onClick={() => navigator.clipboard?.writeText(temporaryPassword)}>نسخ</Button>
          <p className="text-xs text-emerald-900">لن تظهر هذه الكلمة مرة أخرى بعد مغادرة الشاشة.</p>
        </Card>
      )}

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
            {draft.id ? "حفظ التعديلات" : "إضافة موظف وتوليد كلمة مرور"}
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
              <Button variant="outline" size="sm" onClick={() => resetMutation.mutate(user.id)}>إعادة تعيين كلمة المرور</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
