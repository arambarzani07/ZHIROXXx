import type { SyncStoreName } from "@/lib/sync-contract";

export const POS_APP_VERSION = 19;

export type PosRole = "owner" | "manager" | "cashier" | "accountant";

const allStores: SyncStoreName[] = [
  "customers", "suppliers", "products", "sales", "saleReturns", "purchases",
  "purchaseReturns", "expenses", "cashEntries", "losses", "cashShifts",
  "stockAdjustments", "journalEntries", "accounts", "users", "audit", "settings",
];

const cashierRead: SyncStoreName[] = [
  "customers", "products", "sales", "saleReturns", "cashEntries", "cashShifts",
  "journalEntries", "users", "audit", "settings",
];

const cashierWrite: SyncStoreName[] = [
  "customers", "products", "sales", "saleReturns", "cashEntries", "cashShifts", "journalEntries", "audit",
];

const accountantRead: SyncStoreName[] = [
  "customers", "suppliers", "products", "sales", "saleReturns", "purchases", "purchaseReturns",
  "expenses", "cashEntries", "cashShifts", "journalEntries", "accounts", "users", "settings",
  "audit",
];

const accountantWrite: SyncStoreName[] = [
  "customers", "suppliers", "products", "purchases", "purchaseReturns", "expenses",
  "cashEntries", "cashShifts", "journalEntries", "accounts", "audit",
];

export function readStoresForRole(role: PosRole): SyncStoreName[] {
  if (role === "cashier") return [...cashierRead];
  if (role === "accountant") return [...accountantRead];
  return [...allStores];
}

export function writeStoresForRole(role: PosRole): SyncStoreName[] {
  if (role === "cashier") return [...cashierWrite];
  if (role === "accountant") return [...accountantWrite];
  return [...allStores];
}

export function canRoleWriteStore(role: PosRole, storeName: SyncStoreName): boolean {
  return writeStoresForRole(role).includes(storeName);
}

export type ServerStaffProfile = {
  actorId: string;
  email: string;
  displayName: string;
  role: PosRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProductionDevice = {
  deviceId: string;
  label: string;
  actorId: string;
  actorName: string;
  appVersion: number;
  lastRevision: number;
  pendingCount: number;
  conflictCount: number;
  lastSeenAt: string;
};

export type CloudRestorePoint = {
  day: string;
  revision: number;
  recordCount: number;
  createdAt: string;
};

export type ProductionStatus = {
  actor: ServerStaffProfile;
  currentRevision: number;
  devices: ProductionDevice[];
  restorePoints: CloudRestorePoint[];
  staff: ServerStaffProfile[];
  appVersion: number;
};
