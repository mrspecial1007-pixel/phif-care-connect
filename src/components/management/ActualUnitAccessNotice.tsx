export function ActualUnitAccessNotice({ access }: { access?: { allowed: boolean; code: string; message: string } }) {
  if (access?.allowed) return null;
  return <div role="alert" className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <p>{access?.message ?? "حالة اعتماد الوحدات غير متاحة من هذا الإصدار؛ أعد تحميل التطبيق وتحقق من نشر تحديث الخادم والواجهة معًا."}</p>
    {access?.code === "registered_admin_required" && <a href="/settings/users" className="font-semibold underline">فتح إدارة الموظفين لإنشاء / مراجعة حساب المدير</a>}
    <p className="text-xs">لم يتم اعتماد أي وحدة أو تغيير أي فاتورة. الحفظ يتطلب مديرًا موثّقًا على الخادم.</p>
  </div>;
}
