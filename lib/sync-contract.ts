export const SYNC_STORE_NAMES = [
  "customers",
  "suppliers",
  "products",
  "sales",
  "saleReturns",
  "purchases",
  "purchaseReturns",
  "expenses",
  "cashEntries",
  "losses",
  "cashShifts",
  "stockAdjustments",
  "journalEntries",
  "accounts",
  "users",
  "audit",
  "settings",
] as const;

export type SyncStoreName = (typeof SYNC_STORE_NAMES)[number];

export type CloudSyncRecord = {
  storeName: SyncStoreName;
  recordId: string;
  payload: Record<string, unknown>;
  digest: string;
  revision: number;
};

export type CloudSyncMeta = {
  revision: number;
  updatedAt: string | null;
  role?: "owner" | "manager" | "cashier" | "accountant";
  readStores?: SyncStoreName[];
  writeStores?: SyncStoreName[];
};

export type CloudSyncState = CloudSyncMeta & {
  records: CloudSyncRecord[];
  includedStores?: SyncStoreName[];
};

export type CloudSyncChange = Omit<CloudSyncRecord, "revision" | "payload"> & {
  operation: "upsert" | "delete";
  payload: Record<string, unknown> | null;
};

export type CloudSyncDelta = CloudSyncMeta & {
  changes: CloudSyncChange[];
  includedStores: SyncStoreName[];
  merged?: boolean;
};
