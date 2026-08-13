import type { ManagerPermission, PosRole } from "@/lib/production-contract";

export const MANAGER_PERMISSIONS: ManagerPermission[] = [
  "manage_staff", "manage_products", "manage_sales", "manage_purchases",
  "manage_accounting", "view_reports", "manage_settings", "restore_backups",
];

export const MANAGER_PERMISSION_LABELS: Record<ManagerPermission, string> = {
  manage_staff: "بەڕێوەبردنی کارمەندان",
  manage_products: "بەڕێوەبردنی کالا و کۆگا",
  manage_sales: "فرۆشتن و گەڕاندنەوە",
  manage_purchases: "کڕین و دابینکەران",
  manage_accounting: "ژمێریاری و جووڵەی پارە",
  view_reports: "بینینی ڕاپۆرتەکان",
  manage_settings: "ڕێکخستنەکانی مارکێت",
  restore_backups: "پاشەکەوت و گەڕاندنەوە",
};

export type PlatformMarket = {
  marketId: string; marketName: string; marketSlug: string; status: "trial" | "active" | "suspended";
  managerActorId: string | null; managerEmail: string | null; managerName: string | null;
  managerRole: PosRole | null; permissions: ManagerPermission[]; createdAt: string; updatedAt: string;
};
