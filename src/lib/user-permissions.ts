export const TIRYAQ_PERMISSIONS = {
  patients_read: "عرض المستفيدين والبحث",
  patient_detail_read: "عرض تفاصيل المستفيد",
  dispensing_write: "تسجيل الصرف",
  communications_write: "التواصل والرسائل",
  reports_read: "عرض التقارير",
  reports_export: "تصدير التقارير",
  treasury_read: "عرض خزينة الصرف",
  phif_items_read: "PHIF Supplier - عرض الأصناف",
  phif_movements_read: "PHIF Supplier - عرض المستفيدين والكميات وحركات الصرف",
  phif_revenue_read: "PHIF Supplier - عرض قيم الصرف والإيرادات",
  phif_cost_read: "PHIF Supplier - عرض أسعار الشراء والتكاليف",
  phif_profit_read: "PHIF Supplier - عرض الأرباح",
  phif_purchase_price_write: "PHIF Supplier - تعديل أسعار الشراء",
  actual_items_read: "Actual - عرض الأصناف",
  actual_movements_read: "Actual - عرض المستفيدين والكميات وحركات الصرف",
  actual_revenue_read: "Actual - عرض قيم الصرف والإيرادات",
  actual_cost_read: "Actual - عرض أسعار الشراء والتكاليف",
  actual_profit_read: "Actual - عرض الأرباح",
  phif_sync_run: "تشغيل مزامنة PHIF",
  phif_completion_run: "استكمال أصناف الفواتير المحفوظة",
  inventory_read: "عرض المخزون",
  stock_cost_read: "عرض سعر تكلفة مخزون PHIF",
  users_manage: "إدارة الموظفين والصلاحيات",
} as const;

export type TiryaqPermission = keyof typeof TIRYAQ_PERMISSIONS;

export const ALL_TIRYAQ_PERMISSIONS = Object.keys(TIRYAQ_PERMISSIONS) as TiryaqPermission[];

export function normalizePermissions(value: unknown): Record<TiryaqPermission, boolean> {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return ALL_TIRYAQ_PERMISSIONS.reduce((acc, key) => {
    acc[key] = source[key] === true;
    return acc;
  }, {} as Record<TiryaqPermission, boolean>);
}

export function adminPermissions(): Record<TiryaqPermission, boolean> {
  return ALL_TIRYAQ_PERMISSIONS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as Record<TiryaqPermission, boolean>);
}

export function hasPermission(
  role: string | undefined | null,
  permissions: Record<string, boolean> | undefined | null,
  permission: TiryaqPermission,
) {
  return role === "admin" || permissions?.[permission] === true;
}
