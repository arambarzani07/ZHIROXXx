import { SYNC_STORE_NAMES, type CloudSyncRecord } from "@/lib/sync-contract";
import { buildOfficialReceiptNo, createBrowserSafeUuid } from "@/lib/pos-id";
import {
  allocateReturnDiscount,
  calculateBalancedJournalTotals,
  calculateCurrencyDrawer,
  calculateDiscountedSale,
  convertCurrencyToIQD,
  convertIQDToCurrency,
  normalizePaymentMethod,
  resolveUsdRate,
  roundAccountingAmount,
  settlementCurrency,
  settlementOriginalAmount,
  settlementRoundingToleranceIQD,
  type Currency,
  type PaymentMethod,
} from "@/lib/pos-money";

export {
  allocateReturnDiscount,
  convertCurrencyToIQD,
  convertIQDToCurrency,
  DEFAULT_USD_TO_IQD_RATE,
  normalizePaymentMethod,
  resolveUsdRate,
  settlementRoundingToleranceIQD,
} from "@/lib/pos-money";
export type { Currency, PaymentMethod } from "@/lib/pos-money";

export type StoreName =
  | "customers"
  | "suppliers"
  | "products"
  | "sales"
  | "saleReturns"
  | "purchases"
  | "purchaseReturns"
  | "expenses"
  | "cashEntries"
  | "losses"
  | "cashShifts"
  | "stockAdjustments"
  | "journalEntries"
  | "accounts"
  | "users"
  | "audit"
  | "outbox"
  | "settings";

export type StoreCounts = Record<StoreName, number>;

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  balanceIQD: number;
  creditLimitIQD: number;
  note: string;
  createdAt: string;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  phone: string;
  company: string;
  balanceIQD: number;
  note: string;
  createdAt: string;
}

export interface Product {
  id: string;
  barcode: string;
  name: string;
  unit: string;
  purchasePriceIQD: number;
  salePriceIQD: number;
  stock: number;
  lowStock: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItem {
  productId: string;
  barcode: string;
  name: string;
  quantity: number;
  unitPriceIQD: number;
  costPriceIQD: number;
  subtotalIQD: number;
}

export interface Sale {
  id: string;
  receiptNo: string;
  customerId: string | null;
  customerName: string;
  items: SaleItem[];
  subtotalIQD?: number;
  discountIQD?: number;
  totalIQD: number;
  paidIQD: number;
  tenderedIQD?: number;
  changeIQD?: number;
  paymentCurrency?: Currency;
  exchangeRateIQDPerUSD?: number;
  tenderedAmount?: number;
  paidAmount?: number;
  changeAmount?: number;
  paymentMethod?: PaymentMethod;
  debtIQD: number;
  profitIQD: number;
  status: "completed" | "partial" | "returned";
  deviceId?: string;
  operatorId?: string;
  operatorName?: string;
  shiftId?: string;
  createdAt: string;
}

export interface PurchaseItem {
  productId: string;
  barcode: string;
  name: string;
  quantity: number;
  unitCostIQD: number;
  subtotalIQD: number;
}

export interface Purchase {
  id: string;
  receiptNo: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCostIQD: number;
  items?: PurchaseItem[];
  totalIQD: number;
  paidIQD: number;
  paymentCurrency?: Currency;
  exchangeRateIQDPerUSD?: number;
  paidAmount?: number;
  paymentMethod?: PaymentMethod;
  debtIQD: number;
  status: "completed" | "partial" | "returned";
  deviceId?: string;
  operatorId?: string;
  operatorName?: string;
  shiftId?: string | null;
  createdAt: string;
}

export interface ReturnItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceIQD: number;
  subtotalIQD: number;
}

export interface ReturnRecord {
  id: string;
  sourceId: string;
  receiptNo: string;
  grossTotalIQD?: number;
  discountImpactIQD?: number;
  totalIQD: number;
  items?: ReturnItem[];
  debtImpactIQD?: number;
  cashImpactIQD?: number;
  cashCurrency?: Currency;
  exchangeRateIQDPerUSD?: number;
  cashImpactAmount?: number;
  paymentMethod?: PaymentMethod;
  createdAt: string;
}

export interface Expense {
  id: string;
  category: string;
  amountIQD: number;
  currency?: Currency;
  amountOriginal?: number;
  exchangeRateIQDPerUSD?: number;
  paymentMethod?: PaymentMethod;
  note: string;
  createdAt: string;
}

export interface CashEntry {
  id: string;
  receiptNo?: string;
  direction: "in" | "out";
  reason: string;
  partyType: "customer" | "supplier" | "other";
  partyId: string | null;
  partyName: string;
  amountIQD: number;
  currency?: Currency;
  amountOriginal?: number;
  exchangeRateIQDPerUSD?: number;
  paymentMethod?: PaymentMethod;
  shiftId?: string | null;
  deviceId?: string;
  operatorId?: string;
  operatorName?: string;
  note: string;
  createdAt: string;
}

export interface LossRecord {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  costIQD: number;
  reason: string;
  createdAt: string;
}

export interface CashShift {
  id: string;
  operatorId: string;
  operatorName: string;
  deviceId?: string;
  openingCashIQD: number;
  cashInIQD: number;
  cashOutIQD: number;
  expectedCashIQD: number;
  countedCashIQD: number | null;
  differenceIQD: number | null;
  openingCashUSD?: number;
  cashInUSD?: number;
  cashOutUSD?: number;
  expectedCashUSD?: number;
  countedCashUSD?: number | null;
  differenceUSD?: number | null;
  note: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
}

export interface StockAdjustment {
  id: string;
  productId: string;
  productName: string;
  direction: "in" | "out";
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  note: string;
  operatorId: string;
  operatorName: string;
  createdAt: string;
}

export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  openingBalanceIQD: number;
  note: string;
  active: boolean;
  createdAt: string;
}

export type JournalSource =
  | "opening"
  | "recordOpening"
  | "productImport"
  | "sale"
  | "saleReturn"
  | "purchase"
  | "purchaseReturn"
  | "expense"
  | "cash"
  | "loss"
  | "stockAdjustment"
  | "stocktake";

export interface JournalLine {
  accountCode: string;
  accountName: string;
  debitIQD: number;
  creditIQD: number;
}

export interface JournalEntry {
  id: string;
  sourceType: JournalSource;
  sourceId: string;
  reference: string;
  memo: string;
  lines: JournalLine[];
  debitTotalIQD: number;
  creditTotalIQD: number;
  operatorId: string;
  operatorName: string;
  createdAt: string;
}

export interface PosUser {
  id: string;
  name: string;
  email?: string;
  role: "owner" | "manager" | "cashier" | "accountant";
  pinHash: string;
  active: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityId: string;
  operatorId: string;
  operatorName: string;
  details: string;
  createdAt: string;
}

export interface PosSettings {
  id: "main";
  marketName: string;
  phone: string;
  address: string;
  currency: Currency;
  usdEnabled?: boolean;
  usdToIqdRate?: number;
  deviceLockEnabled: boolean;
  scalePrefix: string;
  scaleItemDigits: number;
  scaleDecimals: number;
  receiptWidth: 58 | 80;
  showReceiptBarcode: boolean;
  autoPrintAfterSale: boolean;
  autoOpenCashDrawer?: boolean;
  receiptFooter: string;
  updatedAt: string;
}

export interface BackupInspection {
  version: number;
  exportedAt: string;
  integrity: "verified" | "legacy";
  totalRecords: number;
  counts: Record<StoreName, number>;
}

export type PosSession = Pick<PosUser, "id" | "name" | "role">;

export interface SyncMeta {
  id: "main";
  revision: number;
  deviceId: string;
  lastSyncedAt: string | null;
  deviceLabel?: string;
  receiptCounters?: Record<string, number>;
  lastAutoBackupDay?: string | null;
  baselineRevision?: number;
  serverRole?: "owner" | "manager" | "cashier" | "accountant";
  readStores?: Array<(typeof SYNC_STORE_NAMES)[number]>;
  forceCloudReplace?: boolean;
  inFlightMutationId?: string;
  inFlightBaseRevision?: number;
  inFlightOutboxIds?: string[];
}

export interface DashboardData {
  customers: Customer[];
  suppliers: Supplier[];
  products: Product[];
  sales: Sale[];
  saleReturns: ReturnRecord[];
  purchases: Purchase[];
  purchaseReturns: ReturnRecord[];
  expenses: Expense[];
  cashEntries: CashEntry[];
  losses: LossRecord[];
  cashShifts: CashShift[];
  stockAdjustments: StockAdjustment[];
  journalEntries: JournalEntry[];
  accounts: LedgerAccount[];
  users: PosUser[];
  audit: AuditEntry[];
  settings: PosSettings | null;
  syncMeta: SyncMeta;
}

const DB_NAME = "zhirox-smart-pos";
const DB_VERSION = 10;
const SYNC_META_STORE = "syncMeta";
const SYNC_BASE_STORE = "syncBase";
const SESSION_KEY = "zhirox-pos-active-user";
const SESSION_EVENT = "zhirox-pos-session-change";

export const storeNames: StoreName[] = [
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
  "outbox",
  "settings",
];

let databasePromise: Promise<IDBDatabase> | null = null;

export function openPosDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }
  if (databasePromise) return databasePromise;

  const openingPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
          if (storeName !== "settings") {
            store.createIndex("createdAt", "createdAt", { unique: false });
          }
        }
      }
      if (!db.objectStoreNames.contains(SYNC_META_STORE)) {
        db.createObjectStore(SYNC_META_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SYNC_BASE_STORE)) {
        const store = db.createObjectStore(SYNC_BASE_STORE, { keyPath: "id" });
        store.createIndex("storeName", "storeName", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onblocked = () => reject(new Error("پەنجەرەیەکی کۆنی سیستەم کراوەیە؛ هەموو پەنجەرە کۆنەکان دابخە و دووبارە هەوڵ بدە"));
    request.onerror = () => reject(request.error ?? new Error("نەتوانرا بنکەدراوە بکرێتەوە"));
  });
  databasePromise = openingPromise;
  void openingPromise.catch(() => {
    if (databasePromise === openingPromise) databasePromise = null;
  });
  return databasePromise;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("هەڵەی بنکەدراوە"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("مامەڵەکە تەواو نەبوو"));
    tx.onabort = () => reject(tx.error ?? new Error("مامەڵەکە هەڵوەشایەوە"));
  });
}

const JOURNAL_ACCOUNTS = {
  cash: { code: "1110", name: "قاسە" },
  bank: { code: "1120", name: "بانک/کارت" },
  receivable: { code: "1200", name: "قەرزی لای کڕیار" },
  inventory: { code: "1300", name: "بەهای کۆگا" },
  payable: { code: "2100", name: "قەرزی دابینکەر" },
  openingEquity: { code: "3100", name: "سەرمایەی سەرەتا" },
  sales: { code: "4100", name: "داهاتی فرۆشتن" },
  salesReturns: { code: "4110", name: "گەڕاوی فرۆش" },
  salesDiscounts: { code: "4120", name: "داشکاندنی فرۆش" },
  otherIncome: { code: "4200", name: "داهاتی تر" },
  inventoryGain: { code: "4300", name: "زیادبووی کۆگا" },
  costOfGoods: { code: "5100", name: "تێچووی کالای فرۆشراو" },
  expenses: { code: "5200", name: "خەرجی" },
  inventoryLoss: { code: "5300", name: "خەساری کۆگا" },
  inventoryAdjustmentLoss: { code: "5400", name: "کەمبووی کۆگا" },
} as const;

type JournalAccount = { code: string; name: string };

function roundJournalAmount(value: number): number {
  return roundAccountingAmount(value);
}

export function cashEntryCurrency(entry: CashEntry): Currency {
  return settlementCurrency(entry);
}

export function cashEntryOriginalAmount(entry: CashEntry): number {
  return settlementOriginalAmount(entry);
}

function journalLine(account: JournalAccount, debitIQD = 0, creditIQD = 0): JournalLine {
  return {
    accountCode: account.code,
    accountName: account.name,
    debitIQD: roundJournalAmount(debitIQD),
    creditIQD: roundJournalAmount(creditIQD),
  };
}

function openingDeltaLines(account: JournalAccount, delta: number, normal: "debit" | "credit"): JournalLine[] {
  const amount = roundJournalAmount(Math.abs(delta));
  if (!amount) return [];
  const increaseIsDebit = normal === "debit";
  const accountIsDebit = delta > 0 ? increaseIsDebit : !increaseIsDebit;
  return accountIsDebit
    ? [journalLine(account, amount, 0), journalLine(JOURNAL_ACCOUNTS.openingEquity, 0, amount)]
    : [journalLine(JOURNAL_ACCOUNTS.openingEquity, amount, 0), journalLine(account, 0, amount)];
}

type JournalDraft = Pick<JournalEntry, "sourceType" | "sourceId" | "reference" | "memo" | "createdAt" | "lines"> & {
  id?: string;
  operatorId?: string;
  operatorName?: string;
};

export function buildBalancedJournalEntry(draft: JournalDraft): JournalEntry {
  const lines = draft.lines
    .map((line) => ({
      ...line,
      debitIQD: roundJournalAmount(line.debitIQD),
      creditIQD: roundJournalAmount(line.creditIQD),
    }))
    .filter((line) => line.debitIQD !== 0 || line.creditIQD !== 0);
  if (lines.length < 2) throw new Error("تۆماری ژمێریاری لانیکەم دوو ڕیزی پێویستە");
  if (lines.some((line) => line.debitIQD < 0 || line.creditIQD < 0 || (line.debitIQD > 0 && line.creditIQD > 0))) {
    throw new Error("ڕیزی Debit/Credit دروست نییە");
  }
  const { debitTotalIQD, creditTotalIQD } = calculateBalancedJournalTotals(lines);
  return {
    id: draft.id ?? createId("journal"),
    sourceType: draft.sourceType,
    sourceId: draft.sourceId,
    reference: draft.reference,
    memo: draft.memo,
    lines,
    debitTotalIQD,
    creditTotalIQD,
    operatorId: draft.operatorId ?? "local-owner",
    operatorName: draft.operatorName ?? "بەکارهێنەری ناوخۆ",
    createdAt: draft.createdAt,
  };
}

function addJournalEntry(tx: IDBTransaction, draft: JournalDraft): JournalEntry {
  const operator = parsePosSession(getPosSessionSnapshot());
  const entry = buildBalancedJournalEntry({
    ...draft,
    operatorId: draft.operatorId ?? operator?.id,
    operatorName: draft.operatorName ?? operator?.name,
  });
  tx.objectStore("journalEntries").add(entry);
  return entry;
}

export async function countStores(): Promise<StoreCounts> {
  const db = await openPosDatabase();
  const counts = Object.fromEntries(storeNames.map((name) => [name, 0])) as StoreCounts;
  await Promise.all(
    storeNames.map(async (storeName) => {
      const tx = db.transaction(storeName, "readonly");
      counts[storeName] = await requestAsPromise(tx.objectStore(storeName).count());
    }),
  );
  return counts;
}

export async function listRecords<T>(storeName: StoreName): Promise<T[]> {
  const db = await openPosDatabase();
  const tx = db.transaction(storeName, "readonly");
  return requestAsPromise(tx.objectStore(storeName).getAll()) as Promise<T[]>;
}

export async function getRecord<T>(storeName: StoreName, id: string): Promise<T | undefined> {
  const db = await openPosDatabase();
  const tx = db.transaction(storeName, "readonly");
  return requestAsPromise(tx.objectStore(storeName).get(id)) as Promise<T | undefined>;
}

export async function ensureJournalOpeningSnapshot(): Promise<boolean> {
  const db = await openPosDatabase();
  const tx = db.transaction(["customers", "suppliers", "products", "cashEntries", "journalEntries", "outbox", "audit"], "readwrite");
  if (await requestAsPromise(tx.objectStore("journalEntries").count())) {
    await transactionDone(tx);
    return false;
  }

  const [customers, suppliers, products, cashEntries] = await Promise.all([
    requestAsPromise(tx.objectStore("customers").getAll()) as Promise<Customer[]>,
    requestAsPromise(tx.objectStore("suppliers").getAll()) as Promise<Supplier[]>,
    requestAsPromise(tx.objectStore("products").getAll()) as Promise<Product[]>,
    requestAsPromise(tx.objectStore("cashEntries").getAll()) as Promise<CashEntry[]>,
  ]);
  const cash = cashEntries.reduce((sum, entry) => sum + (entry.direction === "in" ? entry.amountIQD : -entry.amountIQD), 0);
  const receivable = customers.reduce((sum, customer) => sum + customer.balanceIQD, 0);
  const inventory = products.reduce((sum, product) => sum + product.stock * product.purchasePriceIQD, 0);
  const payable = suppliers.reduce((sum, supplier) => sum + supplier.balanceIQD, 0);
  const lines: JournalLine[] = [];
  const addNormalBalance = (account: JournalAccount, value: number, normal: "debit" | "credit") => {
    const amount = roundJournalAmount(Math.abs(value));
    if (!amount) return;
    if ((value >= 0 && normal === "debit") || (value < 0 && normal === "credit")) lines.push(journalLine(account, amount, 0));
    else lines.push(journalLine(account, 0, amount));
  };
  addNormalBalance(JOURNAL_ACCOUNTS.cash, cash, "debit");
  addNormalBalance(JOURNAL_ACCOUNTS.receivable, receivable, "debit");
  addNormalBalance(JOURNAL_ACCOUNTS.inventory, inventory, "debit");
  addNormalBalance(JOURNAL_ACCOUNTS.payable, payable, "credit");

  const debit = roundJournalAmount(lines.reduce((sum, line) => sum + line.debitIQD, 0));
  const credit = roundJournalAmount(lines.reduce((sum, line) => sum + line.creditIQD, 0));
  const difference = roundJournalAmount(debit - credit);
  if (difference > 0) lines.push(journalLine(JOURNAL_ACCOUNTS.openingEquity, 0, difference));
  if (difference < 0) lines.push(journalLine(JOURNAL_ACCOUNTS.openingEquity, Math.abs(difference), 0));
  if (lines.length < 2) {
    await transactionDone(tx);
    return false;
  }

  const now = new Date().toISOString();
  const entry = addJournalEntry(tx, {
    id: "journal_opening_v15",
    sourceType: "opening",
    sourceId: "v15-opening",
    reference: "OPENING-V15",
    memo: "گواستنەوەی باڵانسی هەنووکەیی بۆ تۆماری ژمێریاری یەکگرتوو",
    lines,
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "journalEntry", entityId: entry.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("journal.opening", entry.id, `${entry.debitTotalIQD} IQD`, now));
  await transactionDone(tx);
  return true;
}

function createDefaultSyncMeta(): SyncMeta {
  return {
    id: "main",
    revision: 0,
    deviceId: `device_${createBrowserSafeUuid()}`,
    deviceLabel: "کاشێری سەرەکی",
    lastSyncedAt: null,
    receiptCounters: {},
    lastAutoBackupDay: null,
  };
}

export async function getOrCreateSyncMeta(): Promise<SyncMeta> {
  const db = await openPosDatabase();
  const tx = db.transaction(SYNC_META_STORE, "readwrite");
  const store = tx.objectStore(SYNC_META_STORE);
  const existing = await requestAsPromise(store.get("main")) as SyncMeta | undefined;
  if (existing?.deviceId && Number.isInteger(existing.revision) && existing.revision >= 0) return existing;
  const created = createDefaultSyncMeta();
  store.put(created);
  await transactionDone(tx);
  return created;
}

export async function saveSyncMeta(meta: SyncMeta): Promise<void> {
  const db = await openPosDatabase();
  const tx = db.transaction(SYNC_META_STORE, "readwrite");
  tx.objectStore(SYNC_META_STORE).put(meta);
  await transactionDone(tx);
}

export async function readSyncRecords(): Promise<Array<{
  storeName: (typeof SYNC_STORE_NAMES)[number];
  payload: Record<string, unknown>;
}>> {
  const grouped = await Promise.all(SYNC_STORE_NAMES.map(async (storeName) => ({
    storeName,
    records: await listRecords<Record<string, unknown>>(storeName),
  })));
  return grouped.flatMap(({ storeName, records }) => records.map((payload) => ({ storeName, payload })));
}

type SyncBaselineRecord = {
  id: string;
  storeName: (typeof SYNC_STORE_NAMES)[number];
  recordId: string;
  digest: string;
};

function baselineId(storeName: string, recordId: string) {
  return `${storeName}\u0000${recordId}`;
}

export async function readSyncBaseline(): Promise<SyncBaselineRecord[]> {
  const db = await openPosDatabase();
  const tx = db.transaction(SYNC_BASE_STORE, "readonly");
  return requestAsPromise(tx.objectStore(SYNC_BASE_STORE).getAll()) as Promise<SyncBaselineRecord[]>;
}

export async function replaceSyncBaseline(records: CloudSyncRecord[], revision: number): Promise<void> {
  const meta = await getOrCreateSyncMeta();
  const db = await openPosDatabase();
  const tx = db.transaction([SYNC_BASE_STORE, SYNC_META_STORE], "readwrite");
  const store = tx.objectStore(SYNC_BASE_STORE);
  store.clear();
  for (const record of records) store.put({
    id: baselineId(record.storeName, record.recordId),
    storeName: record.storeName,
    recordId: record.recordId,
    digest: record.digest,
  } satisfies SyncBaselineRecord);
  tx.objectStore(SYNC_META_STORE).put({ ...meta, baselineRevision: revision });
  await transactionDone(tx);
}

export async function applyCloudDelta(input: {
  changes: Array<{ storeName: (typeof SYNC_STORE_NAMES)[number]; recordId: string; operation: "upsert" | "delete"; payload: Record<string, unknown> | null; digest: string }>;
  revision: number;
  updatedAt: string | null;
  outboxIds: string[];
  role?: SyncMeta["serverRole"];
  includedStores?: Array<(typeof SYNC_STORE_NAMES)[number]>;
}): Promise<SyncMeta> {
  const meta = await getOrCreateSyncMeta();
  const db = await openPosDatabase();
  const tx = db.transaction([...SYNC_STORE_NAMES, "outbox", SYNC_BASE_STORE, SYNC_META_STORE], "readwrite");
  const baseline = tx.objectStore(SYNC_BASE_STORE);
  for (const change of input.changes) {
    if (!SYNC_STORE_NAMES.includes(change.storeName)) throw new Error("SYNC_STORE_INVALID");
    const store = tx.objectStore(change.storeName);
    const id = baselineId(change.storeName, change.recordId);
    if (change.operation === "delete") {
      store.delete(change.recordId);
      baseline.delete(id);
    } else {
      if (!change.payload || change.payload.id !== change.recordId) throw new Error("SYNC_RECORD_INVALID");
      store.put(change.payload);
      baseline.put({ id, storeName: change.storeName, recordId: change.recordId, digest: change.digest } satisfies SyncBaselineRecord);
    }
  }
  const outbox = tx.objectStore("outbox");
  for (const id of input.outboxIds) outbox.delete(id);
  const next: SyncMeta = {
    ...meta,
    revision: input.revision,
    baselineRevision: input.revision,
    lastSyncedAt: input.updatedAt ?? new Date().toISOString(),
    serverRole: input.role ?? meta.serverRole,
    readStores: input.includedStores ?? meta.readStores,
    inFlightMutationId: undefined,
    inFlightBaseRevision: undefined,
    inFlightOutboxIds: undefined,
    forceCloudReplace: false,
  };
  tx.objectStore(SYNC_META_STORE).put(next);
  await transactionDone(tx);
  return next;
}

export async function replaceLocalStateFromCloud(input: {
  records: CloudSyncRecord[];
  revision: number;
  updatedAt: string | null;
  includedStores?: Array<(typeof SYNC_STORE_NAMES)[number]>;
  role?: SyncMeta["serverRole"];
}): Promise<void> {
  const meta = await getOrCreateSyncMeta();
  const byStore = new Map(SYNC_STORE_NAMES.map((storeName) => [storeName, [] as CloudSyncRecord[]]));
  for (const record of input.records) {
    if (!SYNC_STORE_NAMES.includes(record.storeName)) throw new Error("SYNC_STORE_INVALID");
    if (!record.payload || record.payload.id !== record.recordId) throw new Error("SYNC_RECORD_INVALID");
    byStore.get(record.storeName)?.push(record);
  }

  const db = await openPosDatabase();
  const includedStores = input.includedStores?.length ? input.includedStores : [...SYNC_STORE_NAMES];
  const tx = db.transaction([...SYNC_STORE_NAMES, "outbox", SYNC_BASE_STORE, SYNC_META_STORE], "readwrite");
  for (const storeName of SYNC_STORE_NAMES) {
    const store = tx.objectStore(storeName);
    store.clear();
    if (includedStores.includes(storeName)) {
      for (const record of byStore.get(storeName) ?? []) store.put(record.payload);
    }
  }
  tx.objectStore("outbox").clear();
  const baseline = tx.objectStore(SYNC_BASE_STORE);
  baseline.clear();
  for (const record of input.records) baseline.put({
    id: baselineId(record.storeName, record.recordId),
    storeName: record.storeName,
    recordId: record.recordId,
    digest: record.digest,
  } satisfies SyncBaselineRecord);
  tx.objectStore(SYNC_META_STORE).put({
    ...meta,
    revision: input.revision,
    baselineRevision: input.revision,
    lastSyncedAt: input.updatedAt ?? new Date().toISOString(),
    serverRole: input.role ?? meta.serverRole,
    readStores: includedStores,
    forceCloudReplace: false,
  } satisfies SyncMeta);
  await transactionDone(tx);
}

export async function commitSuccessfulSync(input: {
  revision: number;
  outboxIds: string[];
  syncedAt?: string | null;
}): Promise<SyncMeta> {
  const meta = await getOrCreateSyncMeta();
  const next: SyncMeta = {
    ...meta,
    revision: input.revision,
    baselineRevision: input.revision,
    lastSyncedAt: input.syncedAt ?? new Date().toISOString(),
  };
  const db = await openPosDatabase();
  const tx = db.transaction(["outbox", SYNC_META_STORE], "readwrite");
  const outbox = tx.objectStore("outbox");
  for (const id of input.outboxIds) outbox.delete(id);
  tx.objectStore(SYNC_META_STORE).put(next);
  await transactionDone(tx);
  return next;
}

export async function saveRecord<T extends { id: string }>(storeName: Exclude<StoreName, "journalEntries">, record: T): Promise<T> {
  const db = await openPosDatabase();
  const tx = db.transaction(storeName, "readwrite");
  await requestAsPromise(tx.objectStore(storeName).put(record));
  return record;
}

function createAuditEntry(action: string, entityId: string, details = "", createdAt = new Date().toISOString()): AuditEntry {
  const operator = parsePosSession(getPosSessionSnapshot());
  return {
    id: createId("audit"),
    action,
    entityId,
    operatorId: operator?.id ?? "local-owner",
    operatorName: operator?.name ?? "بەکارهێنەری ناوخۆ",
    details,
    createdAt,
  };
}

export async function recordAuditEvent(action: string, entityId: string, details = ""): Promise<AuditEntry> {
  const db = await openPosDatabase();
  const entry = createAuditEntry(action, entityId, details);
  const tx = db.transaction("audit", "readwrite");
  tx.objectStore("audit").add(entry);
  await transactionDone(tx);
  return entry;
}

export async function saveRecordWithAudit<T extends { id: string }>(
  storeName: Exclude<StoreName, "audit" | "outbox" | "journalEntries">,
  record: T,
  action: string,
  details = "",
): Promise<T> {
  const db = await openPosDatabase();
  const tx = db.transaction([storeName, "audit", "outbox", "journalEntries"], "readwrite");
  const store = tx.objectStore(storeName);
  const previous = await requestAsPromise(store.get(record.id)) as T | undefined;
  const now = new Date().toISOString();
  let lines: JournalLine[] = [];
  if (storeName === "customers") {
    const next = record as unknown as Customer;
    const old = previous as unknown as Customer | undefined;
    lines = openingDeltaLines(JOURNAL_ACCOUNTS.receivable, next.balanceIQD - (old?.balanceIQD ?? 0), "debit");
  } else if (storeName === "suppliers") {
    const next = record as unknown as Supplier;
    const old = previous as unknown as Supplier | undefined;
    lines = openingDeltaLines(JOURNAL_ACCOUNTS.payable, next.balanceIQD - (old?.balanceIQD ?? 0), "credit");
  } else if (storeName === "products") {
    const next = record as unknown as Product;
    const old = previous as unknown as Product | undefined;
    const nextValue = next.stock * next.purchasePriceIQD;
    const oldValue = old ? old.stock * old.purchasePriceIQD : 0;
    lines = openingDeltaLines(JOURNAL_ACCOUNTS.inventory, nextValue - oldValue, "debit");
  } else if (storeName === "accounts") {
    const next = record as unknown as LedgerAccount;
    const old = previous as unknown as LedgerAccount | undefined;
    const normal = next.type === "asset" || next.type === "expense" ? "debit" : "credit";
    lines = openingDeltaLines({ code: next.code, name: next.name }, next.openingBalanceIQD - (old?.openingBalanceIQD ?? 0), normal);
  }
  tx.objectStore(storeName).put(record);
  if (lines.length) addJournalEntry(tx, {
    sourceType: "recordOpening",
    sourceId: record.id,
    reference: action,
    memo: details || "گۆڕانکاری باڵانسی سەرەتایی",
    lines,
    createdAt: now,
  });
  tx.objectStore("audit").add(createAuditEntry(action, record.id, details, now));
  tx.objectStore("outbox").put({ id: createId("sync"), entity: storeName, entityId: record.id, action: "upsert", createdAt: now });
  await transactionDone(tx);
  return record;
}

export async function importProducts(products: Product[]): Promise<number> {
  if (!products.length) throw new Error("هیچ کالایەکی دروست لە فایلەکەدا نییە");
  const db = await openPosDatabase();
  const tx = db.transaction(["products", "journalEntries", "outbox", "audit"], "readwrite");
  const store = tx.objectStore("products");
  const existing = await requestAsPromise(store.getAll()) as Product[];
  const byBarcode = new Map(existing.map((product) => [product.barcode, product]));
  const seen = new Set<string>();
  const now = new Date().toISOString();
  let inventoryValueDelta = 0;
  for (const product of products) {
    if (!product.barcode.trim() || !product.name.trim()) throw new Error("هەر کالا دەبێت بارکۆد و ناوی هەبێت");
    if (seen.has(product.barcode)) throw new Error(`بارکۆدی ${product.barcode} لە فایلەکەدا دووبارەیە`);
    if (![product.purchasePriceIQD, product.salePriceIQD, product.stock, product.lowStock].every((value) => Number.isFinite(value) && value >= 0)) throw new Error(`ژمارەکانی ${product.name} دروست نین`);
    seen.add(product.barcode);
    const current = byBarcode.get(product.barcode);
    inventoryValueDelta += product.stock * product.purchasePriceIQD - (current ? current.stock * current.purchasePriceIQD : 0);
    store.put({
      ...product,
      id: current?.id ?? product.id,
      createdAt: current?.createdAt ?? product.createdAt,
      updatedAt: now,
    } satisfies Product);
  }
  const inventoryDelta = roundJournalAmount(inventoryValueDelta);
  if (inventoryDelta !== 0) {
    const importId = createId("product_import");
    addJournalEntry(tx, {
      sourceType: "productImport",
      sourceId: importId,
      reference: `CSV-${products.length}`,
      memo: `هێنانی ${products.length} کالا بە CSV`,
      lines: inventoryDelta > 0
        ? [journalLine(JOURNAL_ACCOUNTS.inventory, inventoryDelta, 0), journalLine(JOURNAL_ACCOUNTS.inventoryGain, 0, inventoryDelta)]
        : [journalLine(JOURNAL_ACCOUNTS.inventoryAdjustmentLoss, Math.abs(inventoryDelta), 0), journalLine(JOURNAL_ACCOUNTS.inventory, 0, Math.abs(inventoryDelta))],
      createdAt: now,
    });
  }
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "products", entityId: "bulk", action: "import", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("products.imported", String(products.length), `${products.length} کالا`, now));
  await transactionDone(tx);
  return products.length;
}

export async function deleteRecord(storeName: Exclude<StoreName, "journalEntries">, id: string): Promise<void> {
  const db = await openPosDatabase();
  const tx = db.transaction(storeName, "readwrite");
  await requestAsPromise(tx.objectStore(storeName).delete(id));
}

export function createId(prefix: string): string {
  return `${prefix}_${createBrowserSafeUuid()}`;
}

export async function createReceiptNo(prefix: "F" | "K" | "W" | "D"): Promise<string> {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  const db = await openPosDatabase();
  const tx = db.transaction(SYNC_META_STORE, "readwrite");
  const store = tx.objectStore(SYNC_META_STORE);
  const meta = (await requestAsPromise(store.get("main")) as SyncMeta | undefined) ?? createDefaultSyncMeta();
  const key = `${day}:${prefix}`;
  const sequence = (meta.receiptCounters?.[key] ?? 1000) + 1;
  store.put({ ...meta, receiptCounters: { ...(meta.receiptCounters ?? {}), [key]: sequence } } satisfies SyncMeta);
  await transactionDone(tx);
  return buildOfficialReceiptNo({ prefix, terminalCode: meta.deviceId.slice(-4), sequence, date });
}

export async function updateDeviceLabel(label: string): Promise<SyncMeta> {
  const value = label.trim().slice(0, 60);
  if (!value) throw new Error("ناوی ئامێر پێویستە");
  const meta = await getOrCreateSyncMeta();
  const next = { ...meta, deviceLabel: value };
  await saveSyncMeta(next);
  return next;
}

export async function createPinHash(userId: string, pin: string): Promise<string> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN دەبێت ٤ تا ٨ ژمارە بێت");
  const bytes = new TextEncoder().encode(`${userId}:${pin}:zhirox-local-pos`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyPosPin(user: PosUser, pin: string): Promise<boolean> {
  if (!user.active || !user.pinHash) return false;
  return user.pinHash === await createPinHash(user.id, pin);
}

export function activatePosSession(user: PosSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearPosSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function getPosSessionSnapshot(): string {
  return sessionStorage.getItem(SESSION_KEY) ?? "";
}

export function subscribePosSession(callback: () => void): () => void {
  window.addEventListener(SESSION_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(SESSION_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function parsePosSession(snapshot: string): PosSession | null {
  if (!snapshot) return null;
  try {
    const session = JSON.parse(snapshot) as Partial<PosSession>;
    if (!session.id || !session.name || !session.role) return null;
    return session as PosSession;
  } catch {
    return null;
  }
}

export async function completeSale(input: {
  customerId: string | null;
  items: Array<{ productId: string; quantity: number }>;
  paidAmount: number;
  paymentCurrency: Currency;
  exchangeRateIQDPerUSD?: number;
  paymentMethod?: PaymentMethod;
  discountIQD?: number;
}): Promise<Sale> {
  if (!input.items.length) throw new Error("هیچ کاڵایەک هەڵنەبژێردراوە");
  if (!Number.isFinite(input.paidAmount) || input.paidAmount < 0) throw new Error("بڕی پارەی پێدراو دروست بنووسە");
  const paymentCurrency: Currency = input.paymentCurrency === "USD" ? "USD" : "IQD";
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const exchangeRateIQDPerUSD = paymentCurrency === "USD" ? resolveUsdRate(input.exchangeRateIQDPerUSD) : undefined;
  if (new Set(input.items.map((item) => item.productId)).size !== input.items.length) throw new Error("کالای دووبارە لە پسوڵەکەدا هەیە");
  const meta = await getOrCreateSyncMeta();
  const operator = parsePosSession(getPosSessionSnapshot()) ?? { id: "local-owner", name: "بەکارهێنەری ناوخۆ", role: "owner" as const };
  const receiptNo = await createReceiptNo("F");
  const db = await openPosDatabase();
  const tx = db.transaction(["products", "sales", "customers", "cashEntries", "cashShifts", "journalEntries", "outbox", "audit"], "readwrite");
  const openShift = (await requestAsPromise(tx.objectStore("cashShifts").getAll()) as CashShift[]).find((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === meta.deviceId : shift.operatorId === operator.id),
  );
  if (!openShift) throw new Error("پێش فرۆشتن شەفتی کاشێر بکەرەوە");
  const productsStore = tx.objectStore("products");
  const customerStore = tx.objectStore("customers");
  const saleItems: SaleItem[] = [];
  const productUpdates: Product[] = [];

  for (const cartItem of input.items) {
    const product = (await requestAsPromise(productsStore.get(cartItem.productId))) as Product | undefined;
    if (!product) throw new Error("یەکێک لە کاڵاکان نەدۆزرایەوە");
    if (!Number.isFinite(cartItem.quantity) || cartItem.quantity <= 0 || product.stock < cartItem.quantity) {
      throw new Error(`بڕی ${product.name} لە کۆگا بەس نییە`);
    }
    productUpdates.push({ ...product, stock: product.stock - cartItem.quantity, updatedAt: new Date().toISOString() });
    saleItems.push({
      productId: product.id,
      barcode: product.barcode,
      name: product.name,
      quantity: cartItem.quantity,
      unitPriceIQD: product.salePriceIQD,
      costPriceIQD: product.purchasePriceIQD,
      subtotalIQD: product.salePriceIQD * cartItem.quantity,
    });
  }

  const pricing = calculateDiscountedSale(saleItems.reduce((sum, item) => sum + item.subtotalIQD, 0), input.discountIQD ?? 0);
  const { subtotalIQD, discountIQD, totalIQD } = pricing;
  const tenderedIQD = convertCurrencyToIQD(input.paidAmount, paymentCurrency, exchangeRateIQDPerUSD);
  const overpaymentIQD = tenderedIQD - totalIQD;
  if (paymentMethod !== "cash" && overpaymentIQD > settlementRoundingToleranceIQD(paymentCurrency, exchangeRateIQDPerUSD)) throw new Error("پارەدانی کارت یان گواستنەوە نابێت لە کۆی پسوڵە زیاتر بێت");
  const paidIQD = Math.min(tenderedIQD, totalIQD);
  const changeIQD = paymentMethod === "cash" ? Math.max(0, tenderedIQD - totalIQD) : 0;
  const paidAmount = convertIQDToCurrency(paidIQD, paymentCurrency, exchangeRateIQDPerUSD);
  const changeAmount = convertIQDToCurrency(changeIQD, paymentCurrency, exchangeRateIQDPerUSD);
  const debtIQD = totalIQD - paidIQD;
  let customerName = "کڕیاری گشتی";
  if (debtIQD > 0 && !input.customerId) throw new Error("بۆ فرۆشتنی قەرز پێویستە کڕیار هەڵبژێریت");
  if (input.customerId) {
    const customer = (await requestAsPromise(customerStore.get(input.customerId))) as Customer | undefined;
    if (!customer) throw new Error("کڕیار نەدۆزرایەوە");
    const creditLimitIQD = customer.creditLimitIQD ?? 0;
    const projectedBalance = customer.balanceIQD + debtIQD;
    if (debtIQD > 0 && creditLimitIQD > 0 && projectedBalance > creditLimitIQD) {
      throw new Error(`ئەم فرۆشتنە سنووری قەرزی ${customer.name} تێدەپەڕێنێت؛ سنوور ${creditLimitIQD} IQD ـە`);
    }
    customerName = customer.name;
    customerStore.put({ ...customer, balanceIQD: customer.balanceIQD + debtIQD });
  }
  for (const product of productUpdates) productsStore.put(product);

  const now = new Date().toISOString();
  const sale: Sale = {
    id: createId("sale"),
    receiptNo,
    customerId: input.customerId,
    customerName,
    items: saleItems,
    subtotalIQD,
    discountIQD,
    totalIQD,
    paidIQD,
    tenderedIQD,
    changeIQD,
    paymentCurrency,
    exchangeRateIQDPerUSD,
    tenderedAmount: input.paidAmount,
    paidAmount,
    changeAmount,
    paymentMethod,
    debtIQD,
    profitIQD: roundJournalAmount(saleItems.reduce((sum, item) => sum + (item.unitPriceIQD - item.costPriceIQD) * item.quantity, 0) - discountIQD),
    status: "completed",
    deviceId: meta.deviceId,
    operatorId: operator.id,
    operatorName: operator.name,
    shiftId: openShift.id,
    createdAt: now,
  };
  tx.objectStore("sales").add(sale);
  if (paidIQD > 0 && paymentMethod === "cash") {
    tx.objectStore("cashEntries").add({
      id: createId("cash"), direction: "in", reason: "فرۆشتن", partyType: "customer",
      partyId: input.customerId, partyName: customerName, amountIQD: paidIQD,
      currency: paymentCurrency, amountOriginal: paidAmount, exchangeRateIQDPerUSD, paymentMethod,
      shiftId: openShift.id, deviceId: meta.deviceId, operatorId: operator.id, operatorName: operator.name,
      note: sale.receiptNo, createdAt: now,
    } satisfies CashEntry);
  }
  const saleCostIQD = roundJournalAmount(saleItems.reduce((sum, item) => sum + item.costPriceIQD * item.quantity, 0));
  if (totalIQD > 0 || saleCostIQD > 0) addJournalEntry(tx, {
    sourceType: "sale",
    sourceId: sale.id,
    reference: sale.receiptNo,
    memo: `فرۆشتن بە ${customerName}`,
    lines: [
      journalLine(paymentMethod === "cash" ? JOURNAL_ACCOUNTS.cash : JOURNAL_ACCOUNTS.bank, paidIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.receivable, debtIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.salesDiscounts, discountIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.sales, 0, subtotalIQD),
      journalLine(JOURNAL_ACCOUNTS.costOfGoods, saleCostIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.inventory, 0, saleCostIQD),
    ],
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "sale", entityId: sale.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("sale.completed", sale.id, `${sale.receiptNo} — ${sale.totalIQD} IQD — ${paymentMethod} — discount ${discountIQD}`, now));
  await transactionDone(tx);
  return sale;
}

export function getPurchaseItems(purchase: Purchase): PurchaseItem[] {
  if (purchase.items?.length) return purchase.items;
  return [{
    productId: purchase.productId,
    barcode: "",
    name: purchase.productName,
    quantity: purchase.quantity,
    unitCostIQD: purchase.unitCostIQD,
    subtotalIQD: purchase.totalIQD,
  }];
}

export async function completePurchase(input: {
  supplierId: string;
  items: Array<{ productId: string; quantity: number; unitCostIQD: number }>;
  paidAmount: number;
  paymentCurrency: Currency;
  exchangeRateIQDPerUSD?: number;
  paymentMethod?: PaymentMethod;
}): Promise<Purchase> {
  if (!input.items.length) throw new Error("هیچ کاڵایەک هەڵنەبژێردراوە");
  if (!Number.isFinite(input.paidAmount) || input.paidAmount < 0) throw new Error("بڕی پارەی دراو دروست بنووسە");
  const paymentCurrency: Currency = input.paymentCurrency === "USD" ? "USD" : "IQD";
  const paymentMethod = normalizePaymentMethod(input.paymentMethod);
  const exchangeRateIQDPerUSD = paymentCurrency === "USD" ? resolveUsdRate(input.exchangeRateIQDPerUSD) : undefined;
  const meta = await getOrCreateSyncMeta();
  const operator = parsePosSession(getPosSessionSnapshot()) ?? { id: "local-owner", name: "بەکارهێنەری ناوخۆ", role: "owner" as const };
  const receiptNo = await createReceiptNo("K");
  const db = await openPosDatabase();
  const tx = db.transaction(["products", "purchases", "suppliers", "cashEntries", "cashShifts", "journalEntries", "outbox", "audit"], "readwrite");
  const supplier = (await requestAsPromise(tx.objectStore("suppliers").get(input.supplierId))) as Supplier | undefined;
  if (!supplier) throw new Error("دابینکەر نەدۆزرایەوە");
  const now = new Date().toISOString();
  const purchaseItems: PurchaseItem[] = [];
  const productsStore = tx.objectStore("products");
  for (const requested of input.items) {
    if (!Number.isFinite(requested.quantity) || requested.quantity <= 0 || !Number.isFinite(requested.unitCostIQD) || requested.unitCostIQD < 0) {
      throw new Error("بڕ و نرخی کڕین دروست بنووسە");
    }
    const product = (await requestAsPromise(productsStore.get(requested.productId))) as Product | undefined;
    if (!product) throw new Error("یەکێک لە کاڵاکان نەدۆزرایەوە");
    productsStore.put({ ...product, stock: product.stock + requested.quantity, purchasePriceIQD: requested.unitCostIQD, updatedAt: now } satisfies Product);
    purchaseItems.push({
      productId: product.id, barcode: product.barcode, name: product.name,
      quantity: requested.quantity, unitCostIQD: requested.unitCostIQD,
      subtotalIQD: requested.quantity * requested.unitCostIQD,
    });
  }
  const totalIQD = purchaseItems.reduce((sum, item) => sum + item.subtotalIQD, 0);
  const requestedPaidIQD = convertCurrencyToIQD(input.paidAmount, paymentCurrency, exchangeRateIQDPerUSD);
  if (requestedPaidIQD - totalIQD > settlementRoundingToleranceIQD(paymentCurrency, exchangeRateIQDPerUSD)) throw new Error("بڕی پارەدان نابێت لە کۆی پسوڵە زیاتر بێت");
  const paidIQD = Math.min(requestedPaidIQD, totalIQD);
  const paidAmount = convertIQDToCurrency(paidIQD, paymentCurrency, exchangeRateIQDPerUSD);
  const debtIQD = totalIQD - paidIQD;
  tx.objectStore("suppliers").put({ ...supplier, balanceIQD: supplier.balanceIQD + debtIQD } satisfies Supplier);
  const first = purchaseItems[0];
  const openShift = (await requestAsPromise(tx.objectStore("cashShifts").getAll()) as CashShift[]).find((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === meta.deviceId : shift.operatorId === operator.id),
  );
  const purchase: Purchase = {
    id: createId("purchase"), receiptNo, supplierId: supplier.id,
    supplierName: supplier.name, productId: first.productId,
    productName: purchaseItems.length === 1 ? first.name : `${purchaseItems.length} جۆر کالا`,
    quantity: purchaseItems.reduce((sum, item) => sum + item.quantity, 0), unitCostIQD: first.unitCostIQD,
    items: purchaseItems, totalIQD, paidIQD, paymentCurrency, exchangeRateIQDPerUSD, paidAmount, paymentMethod, debtIQD,
    status: "completed", deviceId: meta.deviceId, operatorId: operator.id, operatorName: operator.name,
    shiftId: openShift?.id ?? null, createdAt: now,
  };
  tx.objectStore("purchases").add(purchase);
  if (paidIQD > 0 && paymentMethod === "cash") {
    tx.objectStore("cashEntries").add({
      id: createId("cash"), direction: "out", reason: "کڕین", partyType: "supplier",
      partyId: supplier.id, partyName: supplier.name, amountIQD: paidIQD,
      currency: paymentCurrency, amountOriginal: paidAmount, exchangeRateIQDPerUSD, paymentMethod,
      shiftId: openShift?.id ?? null, deviceId: meta.deviceId, operatorId: operator.id, operatorName: operator.name,
      note: purchase.receiptNo, createdAt: now,
    } satisfies CashEntry);
  }
  if (totalIQD > 0) addJournalEntry(tx, {
    sourceType: "purchase",
    sourceId: purchase.id,
    reference: purchase.receiptNo,
    memo: `کڕین لە ${supplier.name}`,
    lines: [
      journalLine(JOURNAL_ACCOUNTS.inventory, totalIQD, 0),
      journalLine(paymentMethod === "cash" ? JOURNAL_ACCOUNTS.cash : JOURNAL_ACCOUNTS.bank, 0, paidIQD),
      journalLine(JOURNAL_ACCOUNTS.payable, 0, debtIQD),
    ],
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "purchase", entityId: purchase.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("purchase.completed", purchase.id, `${purchase.receiptNo} — ${purchase.totalIQD} IQD — ${paymentMethod}`, now));
  await transactionDone(tx);
  return purchase;
}

export async function recordLoss(input: { productId: string; quantity: number; reason: string }): Promise<LossRecord> {
  const db = await openPosDatabase();
  const tx = db.transaction(["products", "losses", "journalEntries", "outbox", "audit"], "readwrite");
  const product = (await requestAsPromise(tx.objectStore("products").get(input.productId))) as Product | undefined;
  if (!product) throw new Error("کالا نەدۆزرایەوە");
  if (input.quantity <= 0 || product.stock < input.quantity) throw new Error("بڕی خەساربوو دروست نییە");
  const now = new Date().toISOString();
  tx.objectStore("products").put({ ...product, stock: product.stock - input.quantity, updatedAt: now } satisfies Product);
  const loss: LossRecord = {
    id: createId("loss"), productId: product.id, productName: product.name, quantity: input.quantity,
    costIQD: product.purchasePriceIQD * input.quantity, reason: input.reason, createdAt: now,
  };
  tx.objectStore("losses").add(loss);
  if (loss.costIQD > 0) addJournalEntry(tx, {
    sourceType: "loss",
    sourceId: loss.id,
    reference: loss.id,
    memo: `${loss.reason}: ${loss.productName}`,
    lines: [journalLine(JOURNAL_ACCOUNTS.inventoryLoss, loss.costIQD, 0), journalLine(JOURNAL_ACCOUNTS.inventory, 0, loss.costIQD)],
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "loss", entityId: loss.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("stock.loss", loss.id, `${loss.productName} — ${loss.quantity}`, now));
  await transactionDone(tx);
  return loss;
}

export function calculateShiftCash(shift: CashShift, entries: CashEntry[]) {
  const end = shift.closedAt ?? new Date().toISOString();
  const included = entries.filter((entry) => entry.shiftId
    ? entry.shiftId === shift.id
    : entry.createdAt >= shift.openedAt && entry.createdAt <= end && (!shift.deviceId || !entry.deviceId || entry.deviceId === shift.deviceId));
  return calculateCurrencyDrawer(shift.openingCashIQD, shift.openingCashUSD ?? 0, included);
}

export async function openCashShift(input: { operatorId: string; operatorName: string; openingCashIQD: number; openingCashUSD?: number }): Promise<CashShift> {
  const openingCashUSD = input.openingCashUSD ?? 0;
  if (!Number.isFinite(input.openingCashIQD) || input.openingCashIQD < 0 || !Number.isFinite(openingCashUSD) || openingCashUSD < 0) throw new Error("بڕی قاسەی سەرەتا دروست بنووسە");
  const meta = await getOrCreateSyncMeta();
  const db = await openPosDatabase();
  const tx = db.transaction(["cashShifts", "outbox", "audit"], "readwrite");
  const existing = (await requestAsPromise(tx.objectStore("cashShifts").getAll()) as CashShift[]).find((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === meta.deviceId : shift.operatorId === input.operatorId),
  );
  if (existing) throw new Error(`شەفتی ${existing.operatorName} هێشتا کراوەیە`);
  const now = new Date().toISOString();
  const shift: CashShift = {
    id: createId("shift"), operatorId: input.operatorId, operatorName: input.operatorName, deviceId: meta.deviceId,
    openingCashIQD: input.openingCashIQD, cashInIQD: 0, cashOutIQD: 0,
    expectedCashIQD: input.openingCashIQD, countedCashIQD: null, differenceIQD: null,
    openingCashUSD, cashInUSD: 0, cashOutUSD: 0,
    expectedCashUSD: openingCashUSD, countedCashUSD: null, differenceUSD: null,
    note: "", status: "open", openedAt: now, closedAt: null, createdAt: now,
  };
  tx.objectStore("cashShifts").add(shift);
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "cashShift", entityId: shift.id, action: "open", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("cashShift.opened", shift.id, shift.operatorName, now));
  await transactionDone(tx);
  return shift;
}

export async function closeCashShift(input: { shiftId: string; countedCashIQD: number; countedCashUSD?: number; note: string }): Promise<CashShift> {
  const countedCashUSD = input.countedCashUSD ?? 0;
  if (!Number.isFinite(input.countedCashIQD) || input.countedCashIQD < 0 || !Number.isFinite(countedCashUSD) || countedCashUSD < 0) throw new Error("بڕی قاسەی ژمێردراو دروست بنووسە");
  const db = await openPosDatabase();
  const tx = db.transaction(["cashShifts", "cashEntries", "outbox", "audit"], "readwrite");
  const shift = await requestAsPromise(tx.objectStore("cashShifts").get(input.shiftId)) as CashShift | undefined;
  if (!shift || shift.status !== "open") throw new Error("شەفتی کراوە نەدۆزرایەوە");
  const entries = await requestAsPromise(tx.objectStore("cashEntries").getAll()) as CashEntry[];
  const now = new Date().toISOString();
  const totals = calculateShiftCash({ ...shift, closedAt: now }, entries);
  const closed: CashShift = {
    ...shift, ...totals, countedCashIQD: input.countedCashIQD,
    differenceIQD: input.countedCashIQD - totals.expectedCashIQD,
    countedCashUSD,
    differenceUSD: Math.round((countedCashUSD - totals.expectedCashUSD + Number.EPSILON) * 100) / 100,
    note: input.note.trim(), status: "closed", closedAt: now,
  };
  tx.objectStore("cashShifts").put(closed);
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "cashShift", entityId: shift.id, action: "close", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("cashShift.closed", shift.id, `${input.countedCashIQD} IQD / ${countedCashUSD} USD`, now));
  await transactionDone(tx);
  return closed;
}

export async function adjustStock(input: {
  productId: string;
  direction: "in" | "out";
  quantity: number;
  reason: string;
  note: string;
  operatorId: string;
  operatorName: string;
}): Promise<StockAdjustment> {
  if (input.direction !== "in" && input.direction !== "out") throw new Error("جۆری جووڵەی کۆگا دروست نییە");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new Error("بڕی جووڵەکە دەبێت لە سفر زیاتر بێت");
  const db = await openPosDatabase();
  const tx = db.transaction(["products", "stockAdjustments", "journalEntries", "outbox", "audit"], "readwrite");
  const product = await requestAsPromise(tx.objectStore("products").get(input.productId)) as Product | undefined;
  if (!product) throw new Error("کالا نەدۆزرایەوە");
  if (input.direction === "out" && product.stock < input.quantity) throw new Error(`بڕی ${product.name} لە کۆگا بەس نییە`);
  const now = new Date().toISOString();
  const newStock = input.direction === "in" ? product.stock + input.quantity : product.stock - input.quantity;
  const adjustment: StockAdjustment = {
    id: createId("stock_adjustment"), productId: product.id, productName: product.name,
    direction: input.direction, quantity: input.quantity, previousStock: product.stock, newStock,
    reason: input.reason, note: input.note.trim(), operatorId: input.operatorId,
    operatorName: input.operatorName, createdAt: now,
  };
  tx.objectStore("products").put({ ...product, stock: newStock, updatedAt: now } satisfies Product);
  tx.objectStore("stockAdjustments").add(adjustment);
  const inventoryValue = roundJournalAmount(product.purchasePriceIQD * input.quantity);
  if (inventoryValue > 0) addJournalEntry(tx, {
    sourceType: "stockAdjustment",
    sourceId: adjustment.id,
    reference: adjustment.id,
    memo: `${adjustment.reason}: ${adjustment.productName}`,
    lines: input.direction === "in"
      ? [journalLine(JOURNAL_ACCOUNTS.inventory, inventoryValue, 0), journalLine(JOURNAL_ACCOUNTS.inventoryGain, 0, inventoryValue)]
      : [journalLine(JOURNAL_ACCOUNTS.inventoryAdjustmentLoss, inventoryValue, 0), journalLine(JOURNAL_ACCOUNTS.inventory, 0, inventoryValue)],
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "stockAdjustment", entityId: adjustment.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry(`stock.adjusted.${input.direction}`, adjustment.id, `${adjustment.productName} — ${adjustment.quantity}`, now));
  await transactionDone(tx);
  return adjustment;
}

export async function performStocktake(input: {
  rows: Array<{ productId: string; countedStock: number }>;
  note: string;
  operatorId: string;
  operatorName: string;
}): Promise<StockAdjustment[]> {
  if (!input.rows.length) throw new Error("لانیکەم یەک کالا بۆ ژماردن هەڵبژێرە");
  const uniqueRows = new Map<string, number>();
  for (const row of input.rows) {
    if (!row.productId || uniqueRows.has(row.productId)) throw new Error("کالای دووبارە لە ژماردنەکەدا هەیە");
    if (!Number.isFinite(row.countedStock) || row.countedStock < 0) throw new Error("بڕی ژمێردراو دەبێت سفر یان زیاتر بێت");
    uniqueRows.set(row.productId, Math.round(row.countedStock * 1000) / 1000);
  }

  const db = await openPosDatabase();
  const tx = db.transaction(["products", "stockAdjustments", "journalEntries", "outbox", "audit"], "readwrite");
  const products = tx.objectStore("products");
  const adjustments: StockAdjustment[] = [];
  const now = new Date().toISOString();
  const stocktakeId = createId("stocktake");
  let inventoryIncreaseIQD = 0;
  let inventoryDecreaseIQD = 0;

  for (const [productId, countedStock] of uniqueRows) {
    const product = await requestAsPromise(products.get(productId)) as Product | undefined;
    if (!product) throw new Error("یەکێک لە کالا هەڵبژێردراوەکان نەدۆزرایەوە");
    const difference = Math.round((countedStock - product.stock) * 1000) / 1000;
    if (difference === 0) continue;
    const direction: StockAdjustment["direction"] = difference > 0 ? "in" : "out";
    const adjustment: StockAdjustment = {
      id: createId("stock_adjustment"),
      productId: product.id,
      productName: product.name,
      direction,
      quantity: Math.abs(difference),
      previousStock: product.stock,
      newStock: countedStock,
      reason: "ژماردنی کۆگا",
      note: input.note.trim(),
      operatorId: input.operatorId,
      operatorName: input.operatorName,
      createdAt: now,
    };
    products.put({ ...product, stock: countedStock, updatedAt: now } satisfies Product);
    tx.objectStore("stockAdjustments").add(adjustment);
    tx.objectStore("outbox").put({ id: createId("sync"), entity: "stockAdjustment", entityId: adjustment.id, action: "create", createdAt: now });
    const value = roundJournalAmount(Math.abs(difference) * product.purchasePriceIQD);
    if (direction === "in") inventoryIncreaseIQD += value;
    else inventoryDecreaseIQD += value;
    adjustments.push(adjustment);
  }

  if (!adjustments.length) {
    throw new Error("هیچ جیاوازییەک لە بڕی سیستەم و بڕی ژمێردراودا نییە");
  }
  inventoryIncreaseIQD = roundJournalAmount(inventoryIncreaseIQD);
  inventoryDecreaseIQD = roundJournalAmount(inventoryDecreaseIQD);
  if (inventoryIncreaseIQD > 0 || inventoryDecreaseIQD > 0) addJournalEntry(tx, {
    sourceType: "stocktake",
    sourceId: stocktakeId,
    reference: stocktakeId,
    memo: `ژماردنی کۆگا: ${adjustments.length} کالا`,
    lines: [
      journalLine(JOURNAL_ACCOUNTS.inventory, inventoryIncreaseIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.inventoryGain, 0, inventoryIncreaseIQD),
      journalLine(JOURNAL_ACCOUNTS.inventoryAdjustmentLoss, inventoryDecreaseIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.inventory, 0, inventoryDecreaseIQD),
    ],
    operatorId: input.operatorId,
    operatorName: input.operatorName,
    createdAt: now,
  });
  tx.objectStore("audit").add(createAuditEntry("stocktake.completed", stocktakeId, `${adjustments.length} کالا`, now));
  await transactionDone(tx);
  return adjustments;
}

export async function recordCashEntry(entry: CashEntry): Promise<CashEntry> {
  if (!Number.isFinite(entry.amountIQD) || entry.amountIQD <= 0) throw new Error("بڕی پارە دەبێت لە سفر زیاتر بێت");
  const currency = cashEntryCurrency(entry);
  const exchangeRateIQDPerUSD = currency === "USD" ? resolveUsdRate(entry.exchangeRateIQDPerUSD) : undefined;
  const amountOriginal = entry.amountOriginal ?? convertIQDToCurrency(entry.amountIQD, currency, exchangeRateIQDPerUSD);
  const paymentMethod = normalizePaymentMethod(entry.paymentMethod);
  if (currency === "USD" && Math.abs(convertCurrencyToIQD(amountOriginal, currency, exchangeRateIQDPerUSD) - entry.amountIQD) > 1) throw new Error("بڕی دۆلار لەگەڵ نرخی گۆڕینەوە ناگونجێت");
  const meta = await getOrCreateSyncMeta();
  const operator = parsePosSession(getPosSessionSnapshot()) ?? { id: "local-owner", name: "بەکارهێنەری ناوخۆ", role: "owner" as const };
  const stores: StoreName[] = ["cashEntries", "cashShifts", "journalEntries", "outbox", "audit"];
  if (entry.partyType === "customer") stores.push("customers");
  if (entry.partyType === "supplier") stores.push("suppliers");
  const db = await openPosDatabase();
  const tx = db.transaction(stores, "readwrite");
  const openShift = (await requestAsPromise(tx.objectStore("cashShifts").getAll()) as CashShift[]).find((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === meta.deviceId : shift.operatorId === operator.id),
  );
  const normalizedEntry: CashEntry = {
    ...entry, currency, amountOriginal, exchangeRateIQDPerUSD, paymentMethod,
    shiftId: paymentMethod === "cash" ? openShift?.id ?? null : null,
    deviceId: meta.deviceId, operatorId: operator.id, operatorName: operator.name,
  };
  if (entry.partyId && entry.partyType === "customer") {
    const person = (await requestAsPromise(tx.objectStore("customers").get(entry.partyId))) as Customer | undefined;
    if (person && entry.direction === "in") {
      if (entry.amountIQD > person.balanceIQD) throw new Error("بڕی وەرگیراو لە قەرزی کڕیار زیاترە");
      tx.objectStore("customers").put({ ...person, balanceIQD: person.balanceIQD - entry.amountIQD });
    }
  }
  if (entry.partyId && entry.partyType === "supplier") {
    const person = (await requestAsPromise(tx.objectStore("suppliers").get(entry.partyId))) as Supplier | undefined;
    if (person && entry.direction === "out") {
      if (entry.amountIQD > person.balanceIQD) throw new Error("بڕی پارەدان لە قەرزی دابینکەر زیاترە");
      tx.objectStore("suppliers").put({ ...person, balanceIQD: person.balanceIQD - entry.amountIQD });
    }
  }
  tx.objectStore("cashEntries").add(normalizedEntry);
  let lines: JournalLine[];
  const moneyAccount = paymentMethod === "cash" ? JOURNAL_ACCOUNTS.cash : JOURNAL_ACCOUNTS.bank;
  if (entry.partyType === "customer") {
    lines = entry.direction === "in"
      ? [journalLine(moneyAccount, entry.amountIQD, 0), journalLine(JOURNAL_ACCOUNTS.receivable, 0, entry.amountIQD)]
      : [journalLine(JOURNAL_ACCOUNTS.receivable, entry.amountIQD, 0), journalLine(moneyAccount, 0, entry.amountIQD)];
  } else if (entry.partyType === "supplier") {
    lines = entry.direction === "out"
      ? [journalLine(JOURNAL_ACCOUNTS.payable, entry.amountIQD, 0), journalLine(moneyAccount, 0, entry.amountIQD)]
      : [journalLine(moneyAccount, entry.amountIQD, 0), journalLine(JOURNAL_ACCOUNTS.payable, 0, entry.amountIQD)];
  } else {
    lines = entry.direction === "in"
      ? [journalLine(moneyAccount, entry.amountIQD, 0), journalLine(JOURNAL_ACCOUNTS.otherIncome, 0, entry.amountIQD)]
      : [journalLine(JOURNAL_ACCOUNTS.expenses, entry.amountIQD, 0), journalLine(moneyAccount, 0, entry.amountIQD)];
  }
  addJournalEntry(tx, {
    sourceType: "cash",
    sourceId: normalizedEntry.id,
    reference: normalizedEntry.receiptNo ?? normalizedEntry.id,
    memo: `${normalizedEntry.reason}: ${normalizedEntry.partyName}`,
    lines,
    createdAt: normalizedEntry.createdAt,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "cashEntry", entityId: normalizedEntry.id, action: "create", createdAt: normalizedEntry.createdAt });
  tx.objectStore("audit").add(createAuditEntry(`cash.${normalizedEntry.direction}`, normalizedEntry.id, `${normalizedEntry.partyName} — ${amountOriginal} ${currency} (${normalizedEntry.amountIQD} IQD) — ${paymentMethod}`, normalizedEntry.createdAt));
  await transactionDone(tx);
  return normalizedEntry;
}

export async function recordExpense(expense: Expense): Promise<void> {
  if (!Number.isFinite(expense.amountIQD) || expense.amountIQD <= 0) throw new Error("بڕی خەرجی دەبێت لە سفر زیاتر بێت");
  const currency: Currency = expense.currency === "USD" ? "USD" : "IQD";
  const exchangeRateIQDPerUSD = currency === "USD" ? resolveUsdRate(expense.exchangeRateIQDPerUSD) : undefined;
  const amountOriginal = expense.amountOriginal ?? convertIQDToCurrency(expense.amountIQD, currency, exchangeRateIQDPerUSD);
  const paymentMethod = normalizePaymentMethod(expense.paymentMethod);
  if (currency === "USD" && Math.abs(convertCurrencyToIQD(amountOriginal, currency, exchangeRateIQDPerUSD) - expense.amountIQD) > 1) throw new Error("بڕی خەرجی بە دۆلار لەگەڵ نرخی گۆڕینەوە ناگونجێت");
  const normalizedExpense: Expense = { ...expense, currency, amountOriginal, exchangeRateIQDPerUSD, paymentMethod };
  const meta = await getOrCreateSyncMeta();
  const operator = parsePosSession(getPosSessionSnapshot()) ?? { id: "local-owner", name: "بەکارهێنەری ناوخۆ", role: "owner" as const };
  const db = await openPosDatabase();
  const tx = db.transaction(["expenses", "cashEntries", "cashShifts", "journalEntries", "outbox", "audit"], "readwrite");
  const openShift = (await requestAsPromise(tx.objectStore("cashShifts").getAll()) as CashShift[]).find((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === meta.deviceId : shift.operatorId === operator.id),
  );
  tx.objectStore("expenses").add(normalizedExpense);
  if (paymentMethod === "cash") tx.objectStore("cashEntries").add({
    id: createId("cash"), direction: "out", reason: "خەرجی", partyType: "other",
    partyId: null, partyName: expense.category, amountIQD: expense.amountIQD,
    currency, amountOriginal, exchangeRateIQDPerUSD, paymentMethod,
    shiftId: openShift?.id ?? null, deviceId: meta.deviceId, operatorId: operator.id, operatorName: operator.name,
    note: expense.note, createdAt: expense.createdAt,
  } satisfies CashEntry);
  addJournalEntry(tx, {
    sourceType: "expense",
    sourceId: expense.id,
    reference: expense.id,
    memo: `${expense.category}${expense.note ? `: ${expense.note}` : ""}`,
    lines: [journalLine(JOURNAL_ACCOUNTS.expenses, expense.amountIQD, 0), journalLine(paymentMethod === "cash" ? JOURNAL_ACCOUNTS.cash : JOURNAL_ACCOUNTS.bank, 0, expense.amountIQD)],
    createdAt: expense.createdAt,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "expense", entityId: expense.id, action: "create", createdAt: expense.createdAt });
  tx.objectStore("audit").add(createAuditEntry("expense.created", expense.id, `${expense.category} — ${expense.amountIQD} IQD — ${paymentMethod}`, expense.createdAt));
  await transactionDone(tx);
}

export async function returnSale(saleId: string, requestedItems?: Array<{ productId: string; quantity: number }>): Promise<ReturnRecord> {
  const db = await openPosDatabase();
  const tx = db.transaction(["sales", "saleReturns", "products", "customers", "cashEntries", "journalEntries", "outbox", "audit"], "readwrite");
  const sale = (await requestAsPromise(tx.objectStore("sales").get(saleId))) as Sale | undefined;
  if (!sale || sale.status === "returned") throw new Error("ئەم فرۆشتنە پێشتر گەڕێندراوەتەوە");
  const priorReturns = ((await requestAsPromise(tx.objectStore("saleReturns").getAll())) as ReturnRecord[]).filter((item) => item.sourceId === sale.id);
  const returnedByProduct = new Map<string, number>();
  for (const returned of priorReturns) {
    for (const item of returned.items ?? []) returnedByProduct.set(item.productId, (returnedByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const requested = requestedItems ?? sale.items.map((item) => ({ productId: item.productId, quantity: item.quantity - (returnedByProduct.get(item.productId) ?? 0) }));
  const returnItems: ReturnItem[] = [];
  const now = new Date().toISOString();
  for (const request of requested.filter((item) => item.quantity > 0)) {
    const source = sale.items.find((item) => item.productId === request.productId);
    if (!source) throw new Error("کالای هەڵبژێردراو لە پسوڵەکەدا نییە");
    const remaining = source.quantity - (returnedByProduct.get(source.productId) ?? 0);
    if (!Number.isFinite(request.quantity) || request.quantity <= 0 || request.quantity > remaining) throw new Error(`بڕی گەڕاوەی ${source.name} دروست نییە`);
    const product = (await requestAsPromise(tx.objectStore("products").get(source.productId))) as Product | undefined;
    if (!product) throw new Error(`${source.name} لە لیستی کالا نەدۆزرایەوە`);
    tx.objectStore("products").put({ ...product, stock: product.stock + request.quantity, updatedAt: now } satisfies Product);
    returnItems.push({ productId: source.productId, name: source.name, quantity: request.quantity, unitPriceIQD: source.unitPriceIQD, subtotalIQD: source.unitPriceIQD * request.quantity });
  }
  if (!returnItems.length) throw new Error("لانیکەم یەک کالا و بڕێکی گەڕاو هەڵبژێرە");
  const allReturned = sale.items.every((item) => (returnedByProduct.get(item.productId) ?? 0) + (returnItems.find((returned) => returned.productId === item.productId)?.quantity ?? 0) >= item.quantity);
  const grossTotalIQD = returnItems.reduce((sum, item) => sum + item.subtotalIQD, 0);
  const pricing = allocateReturnDiscount({
    saleSubtotalIQD: sale.subtotalIQD ?? sale.items.reduce((sum, item) => sum + item.subtotalIQD, 0),
    saleDiscountIQD: sale.discountIQD ?? 0,
    grossReturnIQD: grossTotalIQD,
    priorDiscountIQD: priorReturns.reduce((sum, item) => sum + (item.discountImpactIQD ?? 0), 0),
    isFinalReturn: allReturned,
  });
  const { discountImpactIQD, totalIQD } = pricing;
  const priorDebtImpact = priorReturns.reduce((sum, item) => sum + (item.debtImpactIQD ?? 0), 0);
  const debtImpactIQD = Math.min(Math.max(0, sale.debtIQD - priorDebtImpact), totalIQD);
  const cashImpactIQD = totalIQD - debtImpactIQD;
  const paymentMethod = normalizePaymentMethod(sale.paymentMethod);
  const cashCurrency: Currency = sale.paymentCurrency === "USD" ? "USD" : "IQD";
  const returnExchangeRate = cashCurrency === "USD" ? resolveUsdRate(sale.exchangeRateIQDPerUSD) : undefined;
  const cashImpactAmount = convertIQDToCurrency(cashImpactIQD, cashCurrency, returnExchangeRate);
  if (sale.customerId && debtImpactIQD > 0) {
    const customer = (await requestAsPromise(tx.objectStore("customers").get(sale.customerId))) as Customer | undefined;
    if (customer) tx.objectStore("customers").put({ ...customer, balanceIQD: Math.max(0, customer.balanceIQD - debtImpactIQD) });
  }
  const returned: ReturnRecord = { id: createId("sale_return"), sourceId: sale.id, receiptNo: sale.receiptNo, grossTotalIQD, discountImpactIQD, totalIQD, items: returnItems, debtImpactIQD, cashImpactIQD, cashCurrency, exchangeRateIQDPerUSD: returnExchangeRate, cashImpactAmount, paymentMethod, createdAt: now };
  tx.objectStore("sales").put({ ...sale, status: allReturned ? "returned" : "partial" } satisfies Sale);
  tx.objectStore("saleReturns").add(returned);
  if (cashImpactIQD > 0 && paymentMethod === "cash") tx.objectStore("cashEntries").add({ id: createId("cash"), direction: "out", reason: "گەڕاوی فرۆش", partyType: "customer", partyId: sale.customerId, partyName: sale.customerName, amountIQD: cashImpactIQD, currency: cashCurrency, amountOriginal: cashImpactAmount, exchangeRateIQDPerUSD: returnExchangeRate, paymentMethod, shiftId: sale.shiftId ?? null, deviceId: sale.deviceId, operatorId: sale.operatorId, operatorName: sale.operatorName, note: sale.receiptNo, createdAt: now } satisfies CashEntry);
  const returnedCostIQD = roundJournalAmount(returnItems.reduce((sum, item) => {
    const source = sale.items.find((saleItem) => saleItem.productId === item.productId);
    return sum + (source?.costPriceIQD ?? 0) * item.quantity;
  }, 0));
  addJournalEntry(tx, {
    sourceType: "saleReturn",
    sourceId: returned.id,
    reference: sale.receiptNo,
    memo: `گەڕاوی فرۆش: ${sale.customerName}`,
    lines: [
      journalLine(JOURNAL_ACCOUNTS.salesReturns, grossTotalIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.salesDiscounts, 0, discountImpactIQD),
      journalLine(paymentMethod === "cash" ? JOURNAL_ACCOUNTS.cash : JOURNAL_ACCOUNTS.bank, 0, cashImpactIQD),
      journalLine(JOURNAL_ACCOUNTS.receivable, 0, debtImpactIQD),
      journalLine(JOURNAL_ACCOUNTS.inventory, returnedCostIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.costOfGoods, 0, returnedCostIQD),
    ],
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "saleReturn", entityId: returned.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("sale.returned", sale.id, `${sale.receiptNo} — ${totalIQD} IQD`, now));
  await transactionDone(tx);
  return returned;
}

export async function returnPurchase(purchaseId: string, requestedItems?: Array<{ productId: string; quantity: number }>): Promise<ReturnRecord> {
  const db = await openPosDatabase();
  const tx = db.transaction(["purchases", "purchaseReturns", "products", "suppliers", "cashEntries", "journalEntries", "outbox", "audit"], "readwrite");
  const purchase = (await requestAsPromise(tx.objectStore("purchases").get(purchaseId))) as Purchase | undefined;
  if (!purchase || purchase.status === "returned") throw new Error("ئەم کڕینە پێشتر گەڕێندراوەتەوە");
  const sourceItems = getPurchaseItems(purchase);
  const priorReturns = ((await requestAsPromise(tx.objectStore("purchaseReturns").getAll())) as ReturnRecord[]).filter((item) => item.sourceId === purchase.id);
  const returnedByProduct = new Map<string, number>();
  for (const returned of priorReturns) {
    for (const item of returned.items ?? []) returnedByProduct.set(item.productId, (returnedByProduct.get(item.productId) ?? 0) + item.quantity);
  }
  const requested = requestedItems ?? sourceItems.map((item) => ({ productId: item.productId, quantity: item.quantity - (returnedByProduct.get(item.productId) ?? 0) }));
  const supplier = (await requestAsPromise(tx.objectStore("suppliers").get(purchase.supplierId))) as Supplier | undefined;
  const now = new Date().toISOString();
  const returnItems: ReturnItem[] = [];
  for (const request of requested.filter((item) => item.quantity > 0)) {
    const source = sourceItems.find((item) => item.productId === request.productId);
    if (!source) throw new Error("کالای هەڵبژێردراو لە پسوڵەکەدا نییە");
    const remaining = source.quantity - (returnedByProduct.get(source.productId) ?? 0);
    if (!Number.isFinite(request.quantity) || request.quantity <= 0 || request.quantity > remaining) throw new Error(`بڕی گەڕاوەی ${source.name} دروست نییە`);
    const product = (await requestAsPromise(tx.objectStore("products").get(source.productId))) as Product | undefined;
    if (!product || product.stock < request.quantity) throw new Error(`بڕی ${source.name} لە کۆگا بۆ گەڕاندنەوە بەس نییە`);
    tx.objectStore("products").put({ ...product, stock: product.stock - request.quantity, updatedAt: now } satisfies Product);
    returnItems.push({ productId: source.productId, name: source.name, quantity: request.quantity, unitPriceIQD: source.unitCostIQD, subtotalIQD: source.unitCostIQD * request.quantity });
  }
  if (!returnItems.length) throw new Error("لانیکەم یەک کالا و بڕێکی گەڕاو هەڵبژێرە");
  const totalIQD = returnItems.reduce((sum, item) => sum + item.subtotalIQD, 0);
  const priorDebtImpact = priorReturns.reduce((sum, item) => sum + (item.debtImpactIQD ?? 0), 0);
  const debtImpactIQD = Math.min(Math.max(0, purchase.debtIQD - priorDebtImpact), totalIQD);
  const cashImpactIQD = totalIQD - debtImpactIQD;
  const paymentMethod = normalizePaymentMethod(purchase.paymentMethod);
  const cashCurrency: Currency = purchase.paymentCurrency === "USD" ? "USD" : "IQD";
  const returnExchangeRate = cashCurrency === "USD" ? resolveUsdRate(purchase.exchangeRateIQDPerUSD) : undefined;
  const cashImpactAmount = convertIQDToCurrency(cashImpactIQD, cashCurrency, returnExchangeRate);
  if (supplier) tx.objectStore("suppliers").put({ ...supplier, balanceIQD: Math.max(0, supplier.balanceIQD - debtImpactIQD) } satisfies Supplier);
  const allReturned = sourceItems.every((item) => (returnedByProduct.get(item.productId) ?? 0) + (returnItems.find((returned) => returned.productId === item.productId)?.quantity ?? 0) >= item.quantity);
  const returned: ReturnRecord = { id: createId("purchase_return"), sourceId: purchase.id, receiptNo: purchase.receiptNo, totalIQD, items: returnItems, debtImpactIQD, cashImpactIQD, cashCurrency, exchangeRateIQDPerUSD: returnExchangeRate, cashImpactAmount, paymentMethod, createdAt: now };
  tx.objectStore("purchases").put({ ...purchase, status: allReturned ? "returned" : "partial" } satisfies Purchase);
  tx.objectStore("purchaseReturns").add(returned);
  if (cashImpactIQD > 0 && paymentMethod === "cash") tx.objectStore("cashEntries").add({ id: createId("cash"), direction: "in", reason: "گەڕاوی کڕین", partyType: "supplier", partyId: supplier?.id ?? null, partyName: purchase.supplierName, amountIQD: cashImpactIQD, currency: cashCurrency, amountOriginal: cashImpactAmount, exchangeRateIQDPerUSD: returnExchangeRate, paymentMethod, shiftId: purchase.shiftId ?? null, deviceId: purchase.deviceId, operatorId: purchase.operatorId, operatorName: purchase.operatorName, note: purchase.receiptNo, createdAt: now } satisfies CashEntry);
  addJournalEntry(tx, {
    sourceType: "purchaseReturn",
    sourceId: returned.id,
    reference: purchase.receiptNo,
    memo: `گەڕاوی کڕین: ${purchase.supplierName}`,
    lines: [
      journalLine(paymentMethod === "cash" ? JOURNAL_ACCOUNTS.cash : JOURNAL_ACCOUNTS.bank, cashImpactIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.payable, debtImpactIQD, 0),
      journalLine(JOURNAL_ACCOUNTS.inventory, 0, totalIQD),
    ],
    createdAt: now,
  });
  tx.objectStore("outbox").put({ id: createId("sync"), entity: "purchaseReturn", entityId: returned.id, action: "create", createdAt: now });
  tx.objectStore("audit").add(createAuditEntry("purchase.returned", purchase.id, `${purchase.receiptNo} — ${totalIQD} IQD`, now));
  await transactionDone(tx);
  return returned;
}

export async function loadDashboardData(): Promise<DashboardData> {
  const [customers, suppliers, products, sales, saleReturns, purchases, purchaseReturns, expenses, cashEntries, losses, cashShifts, stockAdjustments, journalEntries, accounts, users, audit, settings, syncMeta] = await Promise.all([
    listRecords<Customer>("customers"), listRecords<Supplier>("suppliers"), listRecords<Product>("products"),
    listRecords<Sale>("sales"), listRecords<ReturnRecord>("saleReturns"), listRecords<Purchase>("purchases"),
    listRecords<ReturnRecord>("purchaseReturns"), listRecords<Expense>("expenses"), listRecords<CashEntry>("cashEntries"),
    listRecords<LossRecord>("losses"), listRecords<CashShift>("cashShifts"), listRecords<StockAdjustment>("stockAdjustments"),
    listRecords<JournalEntry>("journalEntries"),
    listRecords<LedgerAccount>("accounts"),
    listRecords<PosUser>("users"), listRecords<AuditEntry>("audit"), getRecord<PosSettings>("settings", "main"), getOrCreateSyncMeta(),
  ]);
  return { customers, suppliers, products, sales, saleReturns, purchases, purchaseReturns, expenses, cashEntries, losses, cashShifts, stockAdjustments, journalEntries, accounts, users, audit, settings: settings ?? null, syncMeta };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type BackupPayload = {
  format: "zhirox-pos-backup";
  version: number;
  exportedAt: string;
  integrity?: { algorithm: "SHA-256"; digest: string };
  data: Record<string, unknown>;
};

async function validateBackup(json: string): Promise<{
  backup: BackupPayload;
  normalized: Map<StoreName, Array<Record<string, unknown>>>;
  inspection: BackupInspection;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("فایلەکە JSON ـی دروست نییە");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("فۆرماتی پاشەکەوت دروست نییە");
  const candidate = parsed as Partial<BackupPayload>;
  if (candidate.format !== "zhirox-pos-backup" || !candidate.data || typeof candidate.data !== "object") {
    throw new Error("ئەم فایلە پاشەکەوتی Zhirox POS نییە");
  }
  if (typeof candidate.version !== "number" || candidate.version > DB_VERSION) {
    throw new Error("وەشانی فایلەکە نوێترە و ناتوانرێت لەم سیستەمەدا بگەڕێندرێتەوە");
  }
  if (typeof candidate.exportedAt !== "string" || Number.isNaN(Date.parse(candidate.exportedAt))) {
    throw new Error("بەرواری پاشەکەوت دروست نییە");
  }

  const normalized = new Map<StoreName, Array<Record<string, unknown>>>();
  const counts = Object.fromEntries(storeNames.map((name) => [name, 0])) as Record<StoreName, number>;
  for (const storeName of storeNames) {
    const records = candidate.data[storeName] ?? [];
    if (!Array.isArray(records)) throw new Error(`داتای ${storeName} دروست نییە`);
    for (const record of records) {
      if (!record || typeof record !== "object" || typeof (record as { id?: unknown }).id !== "string") {
        throw new Error(`تۆمارێکی نادروست لە ${storeName} هەیە`);
      }
    }
    normalized.set(storeName, records as Array<Record<string, unknown>>);
    counts[storeName] = records.length;
  }

  let integrity: BackupInspection["integrity"] = "legacy";
  if (candidate.integrity !== undefined) {
    if (candidate.integrity.algorithm !== "SHA-256" || typeof candidate.integrity.digest !== "string") {
      throw new Error("واژۆی پاراستنی فایلەکە دروست نییە");
    }
    const digest = await sha256(JSON.stringify(candidate.data));
    if (digest !== candidate.integrity.digest) throw new Error("ناوەڕۆکی فایلەکە دوای پاشەکەوت گۆڕدراوە");
    integrity = "verified";
  }

  const backup = candidate as BackupPayload;
  return {
    backup,
    normalized,
    inspection: {
      version: backup.version,
      exportedAt: backup.exportedAt,
      integrity,
      totalRecords: Object.values(counts).reduce((sum, count) => sum + count, 0),
      counts,
    },
  };
}

export async function exportDatabase(): Promise<string> {
  await recordAuditEvent("backup.exported", "database");
  const data = Object.fromEntries(await Promise.all(storeNames.map(async (name) => [name, await listRecords(name)])));
  const payload: BackupPayload = {
    format: "zhirox-pos-backup",
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    integrity: { algorithm: "SHA-256", digest: await sha256(JSON.stringify(data)) },
    data,
  };
  return JSON.stringify(payload, null, 2);
}

export async function inspectBackupJson(json: string): Promise<BackupInspection> {
  return (await validateBackup(json)).inspection;
}

export async function restoreDatabaseFromJson(json: string): Promise<void> {
  const { backup, normalized } = await validateBackup(json);
  const db = await openPosDatabase();
  const tx = db.transaction(storeNames, "readwrite");
  for (const storeName of storeNames) {
    const store = tx.objectStore(storeName);
    store.clear();
    for (const record of normalized.get(storeName) ?? []) store.put(record);
  }
  tx.objectStore("audit").put(createAuditEntry("backup.restored", "database", backup.exportedAt));
  tx.objectStore("outbox").put({
    id: createId("sync"),
    entity: "database",
    entityId: "restore",
    action: "restore",
    createdAt: new Date().toISOString(),
  });
  await transactionDone(tx);
  clearPosSession();
}
