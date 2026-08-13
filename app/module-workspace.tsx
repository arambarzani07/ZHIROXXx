"use client";

import {
  AlertTriangle,
  ArchiveRestore,
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Cloud,
  Download,
  Eye,
  FileText,
  Fingerprint,
  LockKeyhole,
  MonitorCheck,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  Search,
  ScanBarcode,
  ShoppingCart,
  Trash2,
  Upload,
  Usb,
  UsersRound,
  X,
} from "lucide-react";
import JsBarcode from "jsbarcode";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  activatePosSession,
  allocateReturnDiscount,
  adjustStock,
  calculateShiftCash,
  cashEntryCurrency,
  cashEntryOriginalAmount,
  closeCashShift,
  completePurchase,
  completeSale,
  convertCurrencyToIQD,
  convertIQDToCurrency,
  createId,
  createPinHash,
  createReceiptNo,
  DEFAULT_USD_TO_IQD_RATE,
  exportDatabase,
  getPurchaseItems,
  getPosSessionSnapshot,
  importProducts,
  inspectBackupJson,
  loadDashboardData,
  openCashShift,
  parsePosSession,
  performStocktake,
  recordCashEntry,
  recordExpense,
  recordLoss,
  restoreDatabaseFromJson,
  returnPurchase,
  returnSale,
  saveRecordWithAudit,
  settlementRoundingToleranceIQD,
  updateDeviceLabel,
  type BackupInspection,
  type CashEntry,
  type CashShift,
  type Currency,
  type Customer,
  type DashboardData,
  type Expense,
  type LedgerAccount,
  type JournalEntry,
  type PaymentMethod,
  type PosSettings,
  type PosUser,
  type SyncMeta,
  type Product,
  type Purchase,
  type ReturnRecord,
  type Sale,
  type Supplier,
} from "@/lib/pos-db";
import { cashDrawerIsSupported, connectCashDrawer, pulseCashDrawer } from "@/lib/pos-hardware";
import { inspectBarcode, normalizeBarcodeInput, parseScaleBarcode } from "@/lib/pos-barcode";
import { loadProductionStatus, restoreProductionRevision } from "@/lib/pos-production";
import { pullCloudOverLocal } from "@/lib/pos-sync";
import type { ProductionStatus } from "@/lib/production-contract";

export type WorkspaceModuleKey =
  | "cashier" | "sales" | "salesReturns" | "customers"
  | "purchases" | "purchaseReturns" | "suppliers" | "products"
  | "warehouse" | "labels" | "losses" | "accounting" | "accounts"
  | "cashIn" | "cashOut" | "expenses" | "reports"
  | "users" | "audit" | "backup" | "settings" | "help";

type Props = {
  moduleKey: WorkspaceModuleKey;
  onDataChanged: () => Promise<void> | void;
  onNavigate: (key: WorkspaceModuleKey) => void;
};

const emptyData: DashboardData = {
  customers: [], suppliers: [], products: [], sales: [], saleReturns: [], purchases: [],
  purchaseReturns: [], expenses: [], cashEntries: [], losses: [], cashShifts: [], stockAdjustments: [], journalEntries: [], accounts: [], users: [], audit: [], settings: null,
  syncMeta: { id: "main", revision: 0, deviceId: "loading", lastSyncedAt: null },
};

const numberFormatter = new Intl.NumberFormat("ckb-IQ", { maximumFractionDigits: 3 });

function money(value: number) {
  return `${numberFormatter.format(value || 0)} د.ع`;
}

function usdMoney(value: number) {
  return `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value || 0)}`;
}

function currencyMoney(value: number, currency: Currency) {
  return currency === "USD" ? usdMoney(value) : money(value);
}

function configuredUsdRate(settings: PosSettings | null) {
  const savedRate = Number(settings?.usdToIqdRate);
  return Number.isFinite(savedRate) && savedRate > 0 ? savedRate : DEFAULT_USD_TO_IQD_RATE;
}

function entrySettlementMoney(entry: CashEntry) {
  return currencyMoney(cashEntryOriginalAmount(entry), cashEntryCurrency(entry));
}

function dateTime(value: string) {
  return new Date(value).toLocaleString("ckb-IQ", { dateStyle: "short", timeStyle: "short" });
}

function receiptClass(settings: Pick<PosSettings, "receiptWidth"> | null) {
  return `receipt-paper print-receipt receipt-width-${settings?.receiptWidth ?? 80}`;
}

function currentOperator() {
  return parsePosSession(getPosSessionSnapshot()) ?? { id: "local-owner", name: "بەکارهێنەری ناوخۆ", role: "owner" as const };
}

function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function csvCell(value: string | number) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadTextFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

type TransactionStatus = "all" | Sale["status"];

function transactionStatusLabel(status: Sale["status"] | Purchase["status"]) {
  if (status === "returned") return "گەڕاوەتەوە";
  if (status === "partial") return "بەشێک گەڕاوەتەوە";
  return "تەواو";
}

function salePaymentMethod(sale: Sale): PaymentMethod {
  return recordPaymentMethod(sale);
}

function recordPaymentMethod(record: { paymentMethod?: PaymentMethod }): PaymentMethod {
  return record.paymentMethod === "card" || record.paymentMethod === "transfer" ? record.paymentMethod : "cash";
}

function paymentMethodLabel(method: PaymentMethod) {
  return method === "card" ? "کارت" : method === "transfer" ? "گواستنەوە" : "کاش";
}

function printShiftDocument() {
  document.body.dataset.printTarget = "shift";
  const cleanup = () => { delete document.body.dataset.printTarget; };
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
  window.setTimeout(cleanup, 1500);
}

function parseCsvRows(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim()); cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("فایلی CSV داخستنی نیشانەی وتەی تەواو نییە");
  row.push(cell.trim());
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function normalizeDigits(value: string) {
  const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
  return value.replace(/[٠-٩۰-۹]/g, (digit) => String(digits.indexOf(digit) % 10));
}

function parseProductsCsv(source: string): Product[] {
  const rows = parseCsvRows(source);
  if (rows.length < 2) throw new Error("فایلەکە دەبێت سەردێڕ و لانیکەم یەک کالا هەبێت");
  if (rows.length > 50001) throw new Error("لە یەکجاردا زیاتر لە ٥٠ هەزار کالا هێنان ڕێگەپێدراو نییە");
  const headers = rows[0].map((header) => header.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const column = (...aliases: string[]) => headers.findIndex((header) => aliases.includes(header));
  const barcodeColumn = column("بارکۆد", "باركۆد", "باركود", "barcode", "code");
  const nameColumn = column("ناو", "ناویكالا", "name", "productname");
  const unitColumn = column("یەكە", "یەکە", "unit");
  const purchaseColumn = column("نرخیکڕین", "نرخیكڕین", "purchaseprice", "purchasepriceiqd", "cost");
  const saleColumn = column("نرخیفرۆشتن", "saleprice", "salepriceiqd", "price");
  const stockColumn = column("كۆگا", "کۆگا", "stock", "quantity");
  const lowColumn = column("ئاگاداریکەمبوو", "ئاگاداریكەمبوو", "lowstock", "minimumstock");
  if (barcodeColumn < 0 || nameColumn < 0) throw new Error("سەردێڕی بارکۆد و ناو لە فایلەکەدا پێویستن");
  const now = new Date().toISOString();
  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const barcode = normalizeBarcodeInput(values[barcodeColumn] ?? "");
    const name = (values[nameColumn] ?? "").trim();
    if (!barcode || !name) throw new Error(`لە ڕیزی ${index + 2} بارکۆد یان ناو بەتاڵە`);
    if (seen.has(barcode)) throw new Error(`بارکۆدی ${barcode} لە فایلەکەدا دووبارەیە`);
    seen.add(barcode);
    const numberAt = (position: number, fallback = 0) => {
      if (position < 0 || !values[position]?.trim()) return fallback;
      const value = Number(normalizeDigits(values[position]).replaceAll(" ", "").replaceAll(",", ""));
      if (!Number.isFinite(value) || value < 0) throw new Error(`ژمارەی ڕیزی ${index + 2} دروست نییە`);
      return value;
    };
    return {
      id: createId("product"), barcode, name,
      unit: unitColumn >= 0 && values[unitColumn]?.trim() ? values[unitColumn].trim() : "دانە",
      purchasePriceIQD: numberAt(purchaseColumn), salePriceIQD: numberAt(saleColumn),
      stock: numberAt(stockColumn), lowStock: numberAt(lowColumn, 5),
      createdAt: now, updatedAt: now,
    } satisfies Product;
  });
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return <label className={wide ? "form-field field-wide" : "form-field"}><span>{label}</span>{children}</label>;
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="workspace-empty">
      <span>{icon}</span><h3>{title}</h3><p>{text}</p>{action}
    </div>
  );
}

function Toolbar({ title, description, action, search, setSearch }: {
  title: string; description: string; action?: ReactNode; search?: string; setSearch?: (value: string) => void;
}) {
  return (
    <div className="workspace-toolbar">
      <div><h3>{title}</h3><p>{description}</p></div>
      <div className="toolbar-actions">
        {setSearch && <label className="search-box"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="گەڕان..." /></label>}
        {action}
      </div>
    </div>
  );
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="inner-modal" role="dialog" aria-modal="true">
      <button className="inner-modal-scrim" type="button" onClick={onClose} aria-label="داخستن" />
      <section className={wide ? "form-dialog wide" : "form-dialog"}><header><h3>{title}</h3><button type="button" onClick={onClose}><X size={19} /></button></header>{children}</section>
    </div>
  );
}

function SubmitButton({ children = "تۆمارکردن" }: { children?: ReactNode }) {
  return <button className="primary-action" type="submit"><Check size={17} />{children}</button>;
}

function BarcodeGraphic({ value }: { value: string }) {
  const target = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!target.current || !value) return;
    try {
      JsBarcode(target.current, value, { format: "CODE128", displayValue: false, height: 42, width: 1.7, margin: 0 });
    } catch {
      target.current.replaceChildren();
    }
  }, [value]);
  return <svg ref={target} className="barcode-graphic" aria-label={`بارکۆد ${value}`} />;
}

export default function ModuleWorkspace({ moduleKey, onDataChanged, onNavigate }: Props) {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadDashboardData();
    setData(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    loadDashboardData()
      .then((next) => {
        if (!active) return;
        setData(next);
        setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setLoading(false);
        setNotice({ kind: "error", text: error instanceof Error ? error.message : "هەڵەیەک ڕوویدا" });
      });
    return () => { active = false; };
  }, []);

  const runMutation = useCallback(async (operation: () => Promise<unknown>, success: string) => {
    try {
      await operation();
      await refresh();
      await onDataChanged();
      setFormOpen(false);
      setNotice({ kind: "ok", text: success });
      return true;
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "مامەڵەکە تەواو نەبوو" });
      return false;
    }
  }, [onDataChanged, refresh]);

  let content: ReactNode;
  if (loading) content = <div className="workspace-loading"><span /><p>خوێندنەوەی داتای ناوخۆ...</p></div>;
  else {
    switch (moduleKey) {
      case "cashier": content = <Cashier data={data} mutate={runMutation} onNavigate={onNavigate} />; break;
      case "customers": content = <PeoplePage kind="customer" data={data} search={search} setSearch={setSearch} formOpen={formOpen} setFormOpen={setFormOpen} mutate={runMutation} />; break;
      case "suppliers": content = <PeoplePage kind="supplier" data={data} search={search} setSearch={setSearch} formOpen={formOpen} setFormOpen={setFormOpen} mutate={runMutation} />; break;
      case "products": content = <ProductsPage data={data} search={search} setSearch={setSearch} formOpen={formOpen} setFormOpen={setFormOpen} mutate={runMutation} />; break;
      case "warehouse": content = <WarehousePage data={data} search={search} setSearch={setSearch} onNavigate={onNavigate} mutate={runMutation} />; break;
      case "sales": content = <SalesPage data={data} />; break;
      case "salesReturns": content = <ReturnsPage kind="sale" data={data} mutate={runMutation} />; break;
      case "purchases": content = <PurchasesPage data={data} mutate={runMutation} onNavigate={onNavigate} />; break;
      case "purchaseReturns": content = <ReturnsPage kind="purchase" data={data} mutate={runMutation} />; break;
      case "expenses": content = <ExpensePage data={data} formOpen={formOpen} setFormOpen={setFormOpen} mutate={runMutation} />; break;
      case "cashIn": content = <CashPage direction="in" data={data} mutate={runMutation} />; break;
      case "cashOut": content = <CashPage direction="out" data={data} mutate={runMutation} />; break;
      case "losses": content = <LossPage data={data} mutate={runMutation} onNavigate={onNavigate} />; break;
      case "accounts": content = <AccountsPage data={data} formOpen={formOpen} setFormOpen={setFormOpen} mutate={runMutation} />; break;
      case "accounting": content = <AccountingPage data={data} onNavigate={onNavigate} />; break;
      case "reports": content = <ReportsPage data={data} />; break;
      case "users": content = <UsersPage data={data} formOpen={formOpen} setFormOpen={setFormOpen} mutate={runMutation} />; break;
      case "audit": content = <AuditPage data={data} search={search} setSearch={setSearch} />; break;
      case "labels": content = <LabelsPage data={data} onNavigate={onNavigate} />; break;
      case "backup": content = <BackupPage data={data} mutate={runMutation} />; break;
      case "settings": content = <SettingsPage existing={data.settings} users={data.users} syncMeta={data.syncMeta} mutate={runMutation} />; break;
      default: content = <HelpPage />;
    }
  }

  return <div className="module-workspace">{notice && <div className={`notice ${notice.kind}`}><span>{notice.text}</span><button type="button" onClick={() => setNotice(null)}><X size={15} /></button></div>}{content}</div>;
}

type Mutate = (operation: () => Promise<unknown>, success: string) => Promise<boolean>;

function PeoplePage({ kind, data, search, setSearch, formOpen, setFormOpen, mutate }: {
  kind: "customer" | "supplier"; data: DashboardData; search: string; setSearch: (v: string) => void;
  formOpen: boolean; setFormOpen: (v: boolean) => void; mutate: Mutate;
}) {
  const isCustomer = kind === "customer";
  const [statementParty, setStatementParty] = useState<Customer | Supplier | null>(null);
  const [editingParty, setEditingParty] = useState<Customer | Supplier | null>(null);
  const rows = (isCustomer ? data.customers : data.suppliers).filter((item) => `${item.name} ${item.phone} ${item.code}`.toLowerCase().includes(search.toLowerCase()));

  async function submit(event: FormEvent<HTMLFormElement>, existing: Customer | Supplier | null) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const now = new Date().toISOString();
    let saved = false;
    if (isCustomer) {
      const current = existing as Customer | null;
      const creditLimitIQD = Number(form.get("creditLimit") ?? 0);
      const item: Customer = current
        ? { ...current, name, phone: String(form.get("phone") ?? ""), creditLimitIQD, note: String(form.get("note") ?? "") }
        : { id: createId("customer"), code: `C-${String(Date.now()).slice(-5)}`, name, phone: String(form.get("phone") ?? ""), balanceIQD: Number(form.get("balance") ?? 0), creditLimitIQD, note: String(form.get("note") ?? ""), createdAt: now };
      saved = await mutate(async () => {
        if (!name) throw new Error("ناو پێویستە");
        if (!Number.isFinite(creditLimitIQD) || creditLimitIQD < 0) throw new Error("سنووری قەرز دەبێت سفر یان زیاتر بێت");
        return saveRecordWithAudit("customers", item, current ? "customer.updated" : "customer.created", `${item.name} — سنووری قەرز ${item.creditLimitIQD} IQD`);
      }, current ? "زانیاری و سنووری قەرزی کڕیار نوێ کرایەوە" : "کڕیار بە سەرکەوتوویی تۆمارکرا");
    } else {
      const current = existing as Supplier | null;
      const item: Supplier = current
        ? { ...current, name, phone: String(form.get("phone") ?? ""), company: String(form.get("company") ?? ""), note: String(form.get("note") ?? "") }
        : { id: createId("supplier"), code: `S-${String(Date.now()).slice(-5)}`, name, phone: String(form.get("phone") ?? ""), company: String(form.get("company") ?? ""), balanceIQD: Number(form.get("balance") ?? 0), note: String(form.get("note") ?? ""), createdAt: now };
      saved = await mutate(async () => { if (!name) throw new Error("ناو پێویستە"); return saveRecordWithAudit("suppliers", item, current ? "supplier.updated" : "supplier.created", item.name); }, current ? "زانیاری دابینکەر نوێ کرایەوە" : "دابینکەر بە سەرکەوتوویی تۆمارکرا");
    }
    if (saved) {
      if (existing) setEditingParty(null);
      else setFormOpen(false);
    }
  }

  return (
    <>
      <Toolbar title={isCustomer ? "کڕیارەکان" : "دابینکەرەکان"} description={isCustomer ? "قەرز و کشفی حسابی هەر کڕیارێک" : "کۆمپانیا، کڕین و حیسابی دابینکەر"} search={search} setSearch={setSearch} action={<button className="toolbar-primary" type="button" onClick={() => setFormOpen(true)}><Plus size={17} />زیادکردن</button>} />
      {!rows.length ? <EmptyState icon={<UsersRound size={38} />} title={isCustomer ? "هیچ کڕیارێک نییە" : "هیچ دابینکەرێک نییە"} text="داتابەیسەکە بەتاڵە؛ یەکەم تۆمار زیاد بکە." /> :
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>کۆد</th><th>ناو</th><th>مۆبایل</th>{!isCustomer && <th>کۆمپانیا</th>}<th>قەرز</th>{isCustomer && <th>سنووری قەرز</th>}<th>بەروار</th><th>کردار</th></tr></thead><tbody>{rows.map((item) => { const creditLimit = isCustomer ? (item as Customer).creditLimitIQD ?? 0 : 0; return <tr key={item.id}><td>{item.code}</td><td><strong>{item.name}</strong></td><td dir="ltr">{item.phone || "—"}</td>{!isCustomer && <td>{(item as Supplier).company || "—"}</td>}<td className={item.balanceIQD > 0 ? "debt-cell" : ""}>{money(item.balanceIQD)}</td>{isCustomer && <td>{creditLimit > 0 ? <span className={item.balanceIQD > creditLimit ? "credit-limit over" : "credit-limit"}>{money(creditLimit)}</span> : <span className="credit-limit unlimited">بێ سنوور</span>}</td>}<td>{dateTime(item.createdAt)}</td><td><div className="table-actions"><button className="table-action" type="button" onClick={() => setStatementParty(item)}><FileText size={14} />کشفی حساب</button><button className="table-action" type="button" onClick={() => setEditingParty(item)}><Pencil size={14} />دەستکاری</button></div></td></tr>; })}</tbody></table></div>}
      {formOpen && <Modal title={isCustomer ? "زیادکردنی کڕیار" : "زیادکردنی دابینکەر"} onClose={() => setFormOpen(false)}><PeopleForm kind={kind} party={null} onSubmit={(event) => void submit(event, null)} onCancel={() => setFormOpen(false)} /></Modal>}
      {editingParty && <Modal title={`دەستکاری ${editingParty.name}`} onClose={() => setEditingParty(null)}><PeopleForm kind={kind} party={editingParty} onSubmit={(event) => void submit(event, editingParty)} onCancel={() => setEditingParty(null)} /></Modal>}
      {statementParty && <Modal wide title={`کشفی حسابی ${statementParty.name}`} onClose={() => setStatementParty(null)}><PartyStatement kind={kind} party={statementParty} data={data} /></Modal>}
    </>
  );
}

function PeopleForm({ kind, party, onSubmit, onCancel }: { kind: "customer" | "supplier"; party: Customer | Supplier | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const isCustomer = kind === "customer";
  const supplier = !isCustomer && party ? party as Supplier : null;
  const customer = isCustomer && party ? party as Customer : null;
  return <form className="record-form" onSubmit={onSubmit}><Field label="ناو"><input name="name" required autoFocus defaultValue={party?.name} /></Field><Field label="ژمارەی مۆبایل"><input name="phone" inputMode="tel" dir="ltr" defaultValue={party?.phone} /></Field>{!isCustomer && <Field label="ناوی کۆمپانیا"><input name="company" defaultValue={supplier?.company} /></Field>}{!party && <Field label="قەرزی سەرەتایی"><input name="balance" type="number" min="0" defaultValue="0" /></Field>}{isCustomer && <Field label="سنووری قەرز"><input name="creditLimit" type="number" min="0" defaultValue={customer?.creditLimitIQD ?? 0} /></Field>}{isCustomer && <p className="settings-hint field-wide"><AlertTriangle size={17} />سفر واتە بێ سنوور؛ لە کاشێردا فرۆشتنی قەرزی زیاتر لەم بڕە ڕەت دەکرێتەوە.</p>}<Field label="تێبینی" wide><textarea name="note" rows={3} defaultValue={party?.note} /></Field>{party && <p className="settings-hint field-wide"><AlertTriangle size={17} />باڵانسی قەرز لە مامەڵە داراییەکانەوە نوێ دەبێتەوە و لێرە دەستکاری ناکرێت.</p>}<div className="form-actions"><button className="secondary-action" type="button" onClick={onCancel}>پاشگەزبوونەوە</button><SubmitButton>{party ? "نوێکردنەوە" : "تۆمارکردن"}</SubmitButton></div></form>;
}

type StatementEntry = { id: string; createdAt: string; title: string; reference: string; debit: number; credit: number; paymentMethod?: PaymentMethod };

function PartyStatement({ kind, party, data }: { kind: "customer" | "supplier"; party: Customer | Supplier; data: DashboardData }) {
  const isCustomer = kind === "customer";
  const movements: StatementEntry[] = isCustomer
    ? [
        ...data.sales.filter((sale) => sale.customerId === party.id && sale.debtIQD > 0).flatMap((sale) => {
          const rows: StatementEntry[] = [{ id: sale.id, createdAt: sale.createdAt, title: "فرۆشتنی قەرز", reference: sale.receiptNo, debit: sale.debtIQD, credit: 0 }];
          for (const returned of data.saleReturns.filter((item) => item.sourceId === sale.id)) rows.push({ id: returned.id, createdAt: returned.createdAt, title: "گەڕاوی فرۆش", reference: sale.receiptNo, debit: 0, credit: returned.debtImpactIQD ?? (sale.status === "returned" ? sale.debtIQD : 0) });
          return rows;
        }),
        ...data.cashEntries.filter((entry) => entry.partyType === "customer" && entry.partyId === party.id && entry.direction === "in" && entry.reason !== "فرۆشتن").map((entry) => ({ id: entry.id, createdAt: entry.createdAt, title: "پارەوەرگرتن", reference: entry.note || "—", debit: 0, credit: entry.amountIQD, paymentMethod: recordPaymentMethod(entry) })),
      ]
    : [
        ...data.purchases.filter((purchase) => purchase.supplierId === party.id && purchase.debtIQD > 0).flatMap((purchase) => {
          const rows: StatementEntry[] = [{ id: purchase.id, createdAt: purchase.createdAt, title: "کڕینی قەرز", reference: purchase.receiptNo, debit: purchase.debtIQD, credit: 0 }];
          for (const returned of data.purchaseReturns.filter((item) => item.sourceId === purchase.id)) rows.push({ id: returned.id, createdAt: returned.createdAt, title: "گەڕاوی کڕین", reference: purchase.receiptNo, debit: 0, credit: returned.debtImpactIQD ?? (purchase.status === "returned" ? purchase.debtIQD : 0) });
          return rows;
        }),
        ...data.cashEntries.filter((entry) => entry.partyType === "supplier" && entry.partyId === party.id && entry.direction === "out" && entry.reason !== "کڕین").map((entry) => ({ id: entry.id, createdAt: entry.createdAt, title: "پارەدان", reference: entry.note || "—", debit: 0, credit: entry.amountIQD, paymentMethod: recordPaymentMethod(entry) })),
      ];
  movements.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const movementBalance = movements.reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
  const openingBalance = party.balanceIQD - movementBalance;
  const entries: StatementEntry[] = Math.abs(openingBalance) > 0.0001
    ? [{ id: "opening", createdAt: party.createdAt, title: "قەرزی سەرەتایی", reference: party.code, debit: Math.max(0, openingBalance), credit: Math.max(0, -openingBalance) }, ...movements]
    : movements;
  let runningBalance = 0;
  const rows = entries.map((entry) => {
    runningBalance += entry.debit - entry.credit;
    return { ...entry, balance: runningBalance };
  });
  const totalDebit = entries.reduce((sum, entry) => sum + entry.debit, 0);
  const totalCredit = entries.reduce((sum, entry) => sum + entry.credit, 0);

  const creditLimit = isCustomer ? (party as Customer).creditLimitIQD ?? 0 : 0;
  return <div className="statement-sheet print-statement"><div className="statement-actions"><button className="toolbar-primary" type="button" onClick={() => window.print()}><Printer size={16} />چاپی کشفی حساب</button></div><header className="statement-head"><div><p>{data.settings?.marketName || "ZHIROX SMART POS"}</p><h2>کشفی حسابی {isCustomer ? "کڕیار" : "دابینکەر"}</h2></div><div><strong>{party.name}</strong><span>{party.code}</span><small dir="ltr">{party.phone || "—"}</small></div></header><div className={isCustomer ? "statement-summary customer-credit-summary" : "statement-summary"}><Metric label="کۆی قەرز" value={money(totalDebit)} /><Metric label={isCustomer ? "کۆی وەرگیراو" : "کۆی پارەدراو"} value={money(totalCredit)} /><Metric label="ماوەی قەرز" value={money(party.balanceIQD)} alert={party.balanceIQD > 0} />{isCustomer && <Metric label="سنووری قەرز" value={creditLimit > 0 ? money(creditLimit) : "بێ سنوور"} alert={creditLimit > 0 && party.balanceIQD > creditLimit} />}</div>{!rows.length ? <div className="statement-empty">هیچ جووڵەیەکی دارایی تۆمار نەکراوە.</div> : <div className="data-table-wrap"><table className="data-table statement-table"><thead><tr><th>بەروار</th><th>جۆر</th><th>ژمارە/تێبینی</th><th>شێوازی پارەدان</th><th>قەرز</th><th>{isCustomer ? "وەرگیراو" : "پارەدراو"}</th><th>باڵانس</th></tr></thead><tbody>{rows.map((entry) => <tr key={entry.id}><td>{dateTime(entry.createdAt)}</td><td><strong>{entry.title}</strong></td><td dir="auto">{entry.reference}</td><td>{entry.paymentMethod ? <span className={`payment-pill ${entry.paymentMethod}`}>{paymentMethodLabel(entry.paymentMethod)}</span> : "—"}</td><td>{entry.debit ? money(entry.debit) : "—"}</td><td>{entry.credit ? money(entry.credit) : "—"}</td><td className={entry.balance > 0 ? "debt-cell" : ""}>{money(entry.balance)}</td></tr>)}</tbody><tfoot><tr><td colSpan={4}>کۆی گشتی</td><td>{money(totalDebit)}</td><td>{money(totalCredit)}</td><td>{money(party.balanceIQD)}</td></tr></tfoot></table></div>}<footer className="statement-footer"><span>دەرکراوە لە: {new Date().toLocaleString("ckb-IQ")}</span>{data.settings?.phone && <span dir="ltr">{data.settings.phone}</span>}</footer></div>;
}

function ProductsPage({ data, search, setSearch, formOpen, setFormOpen, mutate }: {
  data: DashboardData; search: string; setSearch: (v: string) => void; formOpen: boolean; setFormOpen: (v: boolean) => void; mutate: Mutate;
}) {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [csvPreview, setCsvPreview] = useState<{ filename: string; products: Product[]; newCount: number; updateCount: number } | null>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const filteredRows = data.products.filter((item) => `${item.name} ${item.barcode}`.toLowerCase().includes(search.toLowerCase()));
  const rows = filteredRows.slice(0, 250);
  async function submit(event: FormEvent<HTMLFormElement>, existing: Product | null) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const barcode = normalizeBarcodeInput(String(form.get("barcode") ?? ""));
    const name = String(form.get("name") ?? "").trim();
    const now = new Date().toISOString();
    const product: Product = { id: existing?.id ?? createId("product"), barcode, name, unit: String(form.get("unit") ?? "دانە"), purchasePriceIQD: Number(form.get("purchasePrice") ?? 0), salePriceIQD: Number(form.get("salePrice") ?? 0), stock: Number(form.get("stock") ?? 0), lowStock: Number(form.get("lowStock") ?? 0), createdAt: existing?.createdAt ?? now, updatedAt: now };
    const saved = await mutate(async () => {
      if (!name || !barcode) throw new Error("ناو و بارکۆد پێویستن");
      const inspection = inspectBarcode(barcode);
      if (!inspection.valid && inspection.kind === "invalid") throw new Error(inspection.message);
      if (data.products.some((item) => item.barcode === barcode && item.id !== existing?.id)) throw new Error("ئەم بارکۆدە پێشتر تۆمارکراوە");
      return saveRecordWithAudit("products", product, existing ? "product.updated" : "product.created", product.name);
    }, existing ? "زانیاری کالا نوێ کرایەوە" : "کالا بە سەرکەوتوویی تۆمارکرا");
    if (saved) setEditingProduct(null);
  }

  function exportProductsCsv() {
    const header = ["بارکۆد", "ناو", "یەکە", "نرخی کڕین", "نرخی فرۆشتن", "کۆگا", "ئاگاداری کەمبوو"];
    const lines = [header, ...data.products.map((product) => [product.barcode, product.name, product.unit, product.purchasePriceIQD, product.salePriceIQD, product.stock, product.lowStock])];
    downloadTextFile(`zhirox-products-${localDateKey(new Date())}.csv`, `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  async function readCsv(file: File | undefined) {
    if (!file) return;
    await mutate(async () => {
      if (file.size > 10 * 1024 * 1024) throw new Error("قەبارەی CSV نابێت لە ١٠MB زیاتر بێت");
      const products = parseProductsCsv(await file.text());
      const existingBarcodes = new Set(data.products.map((product) => product.barcode));
      const updateCount = products.filter((product) => existingBarcodes.has(product.barcode)).length;
      setCsvPreview({ filename: file.name, products, updateCount, newCount: products.length - updateCount });
    }, "فایلی CSV پشکنرا؛ پێش هێنان پوختەکە ببینە");
    if (csvInput.current) csvInput.current.value = "";
  }

  async function confirmImport() {
    if (!csvPreview) return;
    const saved = await mutate(() => importProducts(csvPreview.products), `${numberFormatter.format(csvPreview.products.length)} کالا هێنرانە ناو سیستەم`);
    if (saved) setCsvPreview(null);
  }

  return <>
    <Toolbar title="کاڵاکان" description="ناو، بارکۆد، نرخ و هێنانی کۆمەڵەکالا" search={search} setSearch={setSearch} action={<div className="inline-actions"><input ref={csvInput} hidden type="file" accept="text/csv,.csv" onChange={(event) => void readCsv(event.target.files?.[0])} /><button className="secondary-action" type="button" onClick={() => csvInput.current?.click()}><Upload size={16} />هێنانی CSV</button><button className="secondary-action" type="button" onClick={exportProductsCsv}><Download size={16} />دەرکردنی CSV</button><button className="toolbar-primary" type="button" onClick={() => setFormOpen(true)}><Plus size={17} />کالای نوێ</button></div>} />
    {filteredRows.length > rows.length && <p className="result-limit">لە {numberFormatter.format(filteredRows.length)} ئەنجام، یەکەم {numberFormatter.format(rows.length)} کالا پیشان دەدرێت؛ بۆ کالای دیاریکراو گەڕان بەکاربهێنە.</p>}
    {!rows.length ? <EmptyState icon={<PackagePlus size={40} />} title="هیچ کالایەک نییە" text="یەکەم کالا و بارکۆدەکەی زیاد بکە؛ داتای ساختە دانانرێت." /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>بارکۆد</th><th>ناو</th><th>یەکە</th><th>کڕین</th><th>فرۆشتن</th><th>کۆگا</th><th>کردار</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td dir="ltr">{item.barcode}</td><td><strong>{item.name}</strong></td><td>{item.unit}</td><td>{money(item.purchasePriceIQD)}</td><td>{money(item.salePriceIQD)}</td><td><span className={item.stock <= item.lowStock ? "stock-badge low" : "stock-badge"}>{numberFormatter.format(item.stock)}</span></td><td><button className="table-action" type="button" onClick={() => setEditingProduct(item)}><Pencil size={14} />دەستکاری</button></td></tr>)}</tbody></table></div>}
    {formOpen && <Modal title="زیادکردنی کالای نوێ" onClose={() => setFormOpen(false)}><ProductForm product={null} onSubmit={(event) => void submit(event, null)} onCancel={() => setFormOpen(false)} /></Modal>}
    {editingProduct && <Modal title={`دەستکاری ${editingProduct.name}`} onClose={() => setEditingProduct(null)}><ProductForm product={editingProduct} onSubmit={(event) => void submit(event, editingProduct)} onCancel={() => setEditingProduct(null)} /></Modal>}
    {csvPreview && <Modal wide title="پێداچوونەوەی هێنانی CSV" onClose={() => setCsvPreview(null)}><div className="csv-preview"><div className="csv-summary"><div><span>فایل</span><strong dir="ltr">{csvPreview.filename}</strong></div><div><span>کالای نوێ</span><strong>{numberFormatter.format(csvPreview.newCount)}</strong></div><div><span>نوێکردنەوە</span><strong>{numberFormatter.format(csvPreview.updateCount)}</strong></div><div><span>کۆی گشتی</span><strong>{numberFormatter.format(csvPreview.products.length)}</strong></div></div><p className="settings-hint"><AlertTriangle size={17} />بارکۆدی هەبوو نوێ دەکرێتەوە و نرخ و بڕی کۆگاکەی بە نرخی فایلەکە دەگۆڕێت.</p><div className="data-table-wrap"><table className="data-table"><thead><tr><th>بارکۆد</th><th>ناو</th><th>یەکە</th><th>کڕین</th><th>فرۆشتن</th><th>کۆگا</th></tr></thead><tbody>{csvPreview.products.slice(0, 10).map((product) => <tr key={product.barcode}><td dir="ltr">{product.barcode}</td><td><strong>{product.name}</strong></td><td>{product.unit}</td><td>{money(product.purchasePriceIQD)}</td><td>{money(product.salePriceIQD)}</td><td>{numberFormatter.format(product.stock)}</td></tr>)}</tbody></table></div>{csvPreview.products.length > 10 && <small className="csv-more">+ {numberFormatter.format(csvPreview.products.length - 10)} کالای تر</small>}<div className="form-actions"><button className="secondary-action" type="button" onClick={() => setCsvPreview(null)}>پاشگەزبوونەوە</button><button className="primary-action" type="button" onClick={() => void confirmImport()}><Check size={17} />پەسەندکردنی هێنان</button></div></div></Modal>}
  </>;
}

function ProductForm({ product, onSubmit, onCancel }: { product: Product | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const inspection = barcode ? inspectBarcode(barcode) : null;
  return <form className="record-form" onSubmit={onSubmit}><Field label="بارکۆد"><input name="barcode" required autoFocus inputMode="numeric" dir="ltr" value={barcode} onChange={(event) => setBarcode(event.target.value)} /></Field>{inspection && <p className={`barcode-inspection field-wide ${inspection.valid ? "valid" : "warning"}`}><ScanBarcode size={17} /><span><b dir="ltr">{inspection.normalized || "—"}</b>{inspection.message}</span></p>}<Field label="ناوی کالا"><input name="name" required defaultValue={product?.name} /></Field><Field label="یەکە"><select name="unit" defaultValue={product?.unit ?? "دانە"}><option>دانە</option><option>کارتۆن</option><option>کیلۆ</option><option>مەتر</option><option>پاکەت</option></select></Field><Field label={product ? "بڕی ئێستای کۆگا" : "بڕی سەرەتایی"}>{product ? <><input value={product.stock} disabled /><input name="stock" type="hidden" value={product.stock} /></> : <input name="stock" type="number" min="0" step="0.001" defaultValue="0" />}</Field><Field label="نرخی کڕین"><input name="purchasePrice" type="number" min="0" defaultValue={product?.purchasePriceIQD ?? 0} /></Field><Field label="نرخی فرۆشتن"><input name="salePrice" type="number" min="0" defaultValue={product?.salePriceIQD ?? 0} /></Field><Field label="ئاگاداری کەمبوو"><input name="lowStock" type="number" min="0" step="0.001" defaultValue={product?.lowStock ?? 5} /></Field>{product && <p className="settings-hint field-wide"><AlertTriangle size={17} />بۆ زیاد یان کەمکردنی بڕ، بەشی کۆگا بەکاربهێنە تا مێژووی جووڵەکە بپارێزرێت.</p>}<div className="form-actions"><button className="secondary-action" type="button" onClick={onCancel}>پاشگەزبوونەوە</button><SubmitButton>{product ? "نوێکردنەوە" : "تۆمارکردن"}</SubmitButton></div></form>;
}

function WarehousePage({ data, search, setSearch, onNavigate, mutate }: { data: DashboardData; search: string; setSearch: (v: string) => void; onNavigate: Props["onNavigate"]; mutate: Mutate }) {
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const stockValue = data.products.reduce((sum, item) => sum + item.stock * item.purchasePriceIQD, 0);
  const lowProducts = data.products.filter((item) => item.stock > 0 && item.stock <= item.lowStock);
  const outProducts = data.products.filter((item) => item.stock <= 0);
  const matchedRows = data.products.filter((item) => `${item.name} ${item.barcode}`.toLowerCase().includes(search.toLowerCase()));
  const filteredRows = matchedRows.filter((item) => filter === "all" || (filter === "low" ? item.stock > 0 && item.stock <= item.lowStock : item.stock <= 0));
  const rows = filteredRows.slice(0, 250);

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjusting) return;
    const form = new FormData(event.currentTarget);
    const operator = currentOperator();
    const saved = await mutate(() => adjustStock({
      productId: adjusting.id,
      direction: String(form.get("direction")) as "in" | "out",
      quantity: Number(form.get("quantity")),
      reason: String(form.get("reason")),
      note: String(form.get("note") ?? ""),
      operatorId: operator.id,
      operatorName: operator.name,
    }), "بڕی کۆگا نوێ کرایەوە و جووڵەکە پارێزرا");
    if (saved) setAdjusting(null);
  }

  function exportLowStockCsv() {
    const alertRows = data.products.filter((item) => item.stock <= item.lowStock).sort((a, b) => a.stock - b.stock);
    if (!alertRows.length) return;
    const lines: Array<Array<string | number>> = [["بارکۆد", "ناوی کالا", "یەکە", "بڕی ئێستا", "سنووری کەمبوون", "بڕی پێشنیارکراوی کڕین"]];
    alertRows.forEach((item) => lines.push([item.barcode, item.name, item.unit, item.stock, item.lowStock, Math.max(0, item.lowStock * 2 - item.stock)]));
    downloadTextFile(`zhirox-low-stock-${localDateKey(new Date())}.csv`, `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  const history = [...data.stockAdjustments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
  return <>
    <Toolbar title="کۆگا" description="ناوەندی ئاگاداری، ژماردنی کۆگا و مێژووی جووڵەکان" search={search} setSearch={setSearch} action={<div className="inline-actions"><button className="secondary-action" type="button" disabled={!lowProducts.length && !outProducts.length} onClick={exportLowStockCsv}><Download size={16} />لیستی کەمبوو</button><button className="secondary-action" type="button" disabled={!data.products.length} onClick={() => setStocktakeOpen(true)}><ClipboardCheck size={16} />ژماردنی کۆگا</button><button className="toolbar-primary" type="button" onClick={() => onNavigate("products")}><Plus size={17} />کالا</button></div>} />
    <div className="warehouse-summary"><Metric label="جۆری کالا" value={numberFormatter.format(data.products.length)} /><Metric label="بەهای کۆگا" value={money(stockValue)} /><Metric label="کالای کەمبوو" value={numberFormatter.format(lowProducts.length)} alert={lowProducts.length > 0} /><Metric label="تەواوبوو" value={numberFormatter.format(outProducts.length)} alert={outProducts.length > 0} /></div>
    <div className="stock-alert-center"><div><BellRing size={19} /><span><strong>ناوەندی ئاگاداری کۆگا</strong><small>{lowProducts.length + outProducts.length ? `${numberFormatter.format(lowProducts.length + outProducts.length)} کالا پێویستی بە چاودێری هەیە` : "هەموو کالا بە بڕی پێویست بەردەستن"}</small></span></div><div className="stock-filter-tabs"><button className={filter === "all" ? "active" : ""} type="button" onClick={() => setFilter("all")}>هەموو <b>{numberFormatter.format(data.products.length)}</b></button><button className={filter === "low" ? "active" : ""} type="button" onClick={() => setFilter("low")}>کەمبوو <b>{numberFormatter.format(lowProducts.length)}</b></button><button className={filter === "out" ? "active" : ""} type="button" onClick={() => setFilter("out")}>تەواوبوو <b>{numberFormatter.format(outProducts.length)}</b></button></div></div>
    {filteredRows.length > rows.length && <p className="result-limit">لە {numberFormatter.format(filteredRows.length)} ئەنجام، یەکەم {numberFormatter.format(rows.length)} کالا پیشان دەدرێت؛ بۆ کالای دیاریکراو گەڕان بەکاربهێنە.</p>}
    {!rows.length ? <EmptyState icon={<ArchiveRestore size={40} />} title={filter === "all" ? "کۆگا بەتاڵە" : "کالای ئاگادارکراو نییە"} text={filter === "all" ? "کاڵاکان زیاد بکە تا بڕ و بەهای کۆگا لێرە دەربکەوێت." : "لەو فلتەرەدا هیچ کالایەک نەدۆزرایەوە."} /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>کالا</th><th>بارکۆد</th><th>بڕ</th><th>سنووری کەمبوون</th><th>نرخی کڕین</th><th>بەها</th><th>دۆخ</th><th>کردار</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.name}</strong></td><td dir="ltr">{item.barcode}</td><td>{numberFormatter.format(item.stock)} {item.unit}</td><td>{numberFormatter.format(item.lowStock)} {item.unit}</td><td>{money(item.purchasePriceIQD)}</td><td>{money(item.stock * item.purchasePriceIQD)}</td><td>{item.stock <= 0 ? <span className="status-pill returned">تەواوبوو</span> : item.stock <= item.lowStock ? <span className="status-pill warning">کەمە</span> : <span className="status-pill success">باشە</span>}</td><td><button className="table-action" type="button" onClick={() => setAdjusting(item)}><Pencil size={14} />ڕێکخستنی بڕ</button></td></tr>)}</tbody></table></div>}
    {history.length > 0 && <><div className="subsection-title"><h4>دوایین جووڵەکانی کۆگا</h4><span>{numberFormatter.format(data.stockAdjustments.length)}</span></div><div className="data-table-wrap compact"><table className="data-table"><thead><tr><th>کالا</th><th>جووڵە</th><th>پێشوو</th><th>نوێ</th><th>هۆکار</th><th>بەکارهێنەر</th><th>بەروار</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><strong>{item.productName}</strong></td><td className={item.direction === "in" ? "stock-in" : "stock-out"}>{item.direction === "in" ? "+" : "−"}{numberFormatter.format(item.quantity)}</td><td>{numberFormatter.format(item.previousStock)}</td><td>{numberFormatter.format(item.newStock)}</td><td>{item.reason}{item.note ? ` — ${item.note}` : ""}</td><td>{item.operatorName}</td><td>{dateTime(item.createdAt)}</td></tr>)}</tbody></table></div></>}
    {adjusting && <Modal title={`ڕێکخستنی بڕی ${adjusting.name}`} onClose={() => setAdjusting(null)}><form className="record-form" onSubmit={(event) => void submitAdjustment(event)}><Field label="بڕی ئێستا"><input value={`${numberFormatter.format(adjusting.stock)} ${adjusting.unit}`} disabled /></Field><Field label="جۆری جووڵە"><select name="direction" defaultValue="in"><option value="in">زیادکردن بۆ کۆگا</option><option value="out">کەمکردن لە کۆگا</option></select></Field><Field label="بڕ"><input name="quantity" type="number" min="0.001" step="0.001" required autoFocus /></Field><Field label="هۆکار"><select name="reason"><option>ژماردنی کۆگا</option><option>ڕاستکردنەوە</option><option>کالای دۆزراوە</option><option>کەمبووی کۆگا</option><option>هی تر</option></select></Field><Field label="تێبینی" wide><textarea name="note" rows={3} /></Field><div className="form-actions"><button className="secondary-action" type="button" onClick={() => setAdjusting(null)}>پاشگەزبوونەوە</button><SubmitButton>پەسەندکردنی جووڵە</SubmitButton></div></form></Modal>}
    {stocktakeOpen && <Modal wide title="ژماردنی ڕاستەقینەی کۆگا" onClose={() => setStocktakeOpen(false)}><StocktakeEditor data={data} mutate={mutate} onClose={() => setStocktakeOpen(false)} /></Modal>}
  </>;
}

function StocktakeEditor({ data, mutate, onClose }: { data: DashboardData; mutate: Mutate; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const selected = data.products.filter((product) => Object.hasOwn(counted, product.id));
  const suggestions = query.trim() ? data.products.filter((product) => `${product.name} ${product.barcode}`.toLowerCase().includes(query.trim().toLowerCase()) && !Object.hasOwn(counted, product.id)).slice(0, 6) : [];

  function addProduct(product: Product) {
    setCounted((current) => Object.hasOwn(current, product.id) ? current : { ...current, [product.id]: String(product.stock) });
    setQuery("");
    setError("");
  }

  function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim().toLowerCase();
    if (!value) return;
    const product = data.products.find((item) => item.barcode.toLowerCase() === value || item.name.toLowerCase() === value) ?? suggestions[0];
    if (!product) { setError("کالا یان بارکۆدەکە نەدۆزرایەوە"); return; }
    addProduct(product);
  }

  async function submit() {
    const operator = currentOperator();
    const rows = selected.map((product) => ({ productId: product.id, countedStock: Number(counted[product.id]) }));
    const saved = await mutate(() => performStocktake({ rows, note, operatorId: operator.id, operatorName: operator.name }), "ژماردنی کۆگا پەسەندکرا و جیاوازییەکان نوێ کرانەوە");
    if (saved) onClose();
  }

  return <div className="stocktake-editor"><div className="stocktake-search"><form className="cashier-search" onSubmit={scan}><ScanBarcode size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بارکۆد بسکەنە یان ناوی کالا بنووسە..." dir="auto" /><button type="submit">زیادکردن</button></form>{suggestions.length > 0 && <div className="stocktake-suggestions">{suggestions.map((product) => <button type="button" key={product.id} onClick={() => addProduct(product)}><span><strong>{product.name}</strong><small dir="ltr">{product.barcode}</small></span><b>{numberFormatter.format(product.stock)} {product.unit}</b></button>)}</div>}{error && <p className="purchase-error">{error}</p>}</div><div className="stocktake-info"><ClipboardCheck size={20} /><p>هەر کالا بسکەنە، بڕی ڕاستەقینەی ناو کۆگا بنووسە؛ تەنها جیاوازییەکان بە یەک مامەڵە نوێ دەکرێنەوە.</p><span>{numberFormatter.format(selected.length)} کالا</span></div>{!selected.length ? <div className="stocktake-empty">هێشتا هیچ کالایەک بۆ ژماردن زیاد نەکراوە.</div> : <div className="data-table-wrap"><table className="data-table stocktake-table"><thead><tr><th>کالا</th><th>بارکۆد</th><th>بڕی سیستەم</th><th>بڕی ژمێردراو</th><th>جیاوازی</th><th /></tr></thead><tbody>{selected.map((product) => { const value = counted[product.id]; const difference = value === "" ? null : Math.round((Number(value) - product.stock) * 1000) / 1000; return <tr key={product.id}><td><strong>{product.name}</strong><small>{product.unit}</small></td><td dir="ltr">{product.barcode}</td><td>{numberFormatter.format(product.stock)}</td><td><input aria-label={`بڕی ژمێردراوی ${product.name}`} type="number" min="0" step="0.001" required value={value} onChange={(event) => setCounted((current) => ({ ...current, [product.id]: event.target.value }))} /></td><td className={difference && difference > 0 ? "stock-in" : difference && difference < 0 ? "stock-out" : ""}>{difference === null ? "—" : difference > 0 ? `+${numberFormatter.format(difference)}` : numberFormatter.format(difference)}</td><td><button className="icon-danger" type="button" aria-label={`لابردنی ${product.name}`} onClick={() => setCounted((current) => { const next = { ...current }; delete next[product.id]; return next; })}><Trash2 size={15} /></button></td></tr>; })}</tbody></table></div>}<div className="stocktake-footer"><Field label="تێبینی ژماردن"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="نموونە: ژماردنی کۆتایی مانگ" /></Field><div className="inline-actions"><button className="secondary-action" type="button" onClick={onClose}>پاشگەزبوونەوە</button><button className="primary-action" type="button" disabled={!selected.length || selected.some((product) => counted[product.id] === "" || Number(counted[product.id]) < 0)} onClick={() => void submit()}><Check size={17} />پەسەندکردنی جیاوازی</button></div></div></div>;
}

function CashShiftBar({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const [mode, setMode] = useState<"open" | "close" | null>(null);
  const [lastClosedShift, setLastClosedShift] = useState<CashShift | null>(null);
  const operator = currentOperator();
  const openShift = [...data.cashShifts].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).find((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === data.syncMeta.deviceId : shift.operatorId === operator.id),
  ) ?? null;
  const totals = openShift ? calculateShiftCash(openShift, data.cashEntries) : null;
  const usdEnabled = data.settings?.usdEnabled ?? false;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result: { closed: CashShift | null } = { closed: null };
    const saved = mode === "open"
      ? await mutate(() => openCashShift({ operatorId: operator.id, operatorName: operator.name, openingCashIQD: Number(form.get("openingCash")), openingCashUSD: usdEnabled ? Number(form.get("openingCashUSD") ?? 0) : 0 }), "شەفتی کاشێر دەستی پێکرد")
      : openShift
        ? await mutate(async () => { result.closed = await closeCashShift({ shiftId: openShift.id, countedCashIQD: Number(form.get("countedCash")), countedCashUSD: usdEnabled ? Number(form.get("countedCashUSD") ?? 0) : 0, note: String(form.get("note") ?? "") }); }, "شەفت داخرا و جیاوازی هەردوو قاسە هەژمارکرا")
        : false;
    if (saved) {
      setMode(null);
      if (result.closed) setLastClosedShift(result.closed);
    }
  }

  return <>
    <section className={`shift-bar ${openShift ? "open" : "closed"}`}>
      <div className="shift-state"><span>{openShift ? "شەفتی کاشێر کراوەیە" : "شەفتی کاشێر داخراوە"}</span><strong>{openShift ? openShift.operatorName : "پێش داخستنی ڕۆژ شەفت بکەرەوە"}</strong>{openShift && <small>دەستپێک: {dateTime(openShift.openedAt)}</small>}</div>
      {openShift && totals && <div className="shift-live"><span>IQD هاتووە ناوەوە <b>{money(totals.cashInIQD)}</b></span><span>IQD چووەتە دەرەوە <b>{money(totals.cashOutIQD)}</b></span><span>قاسەی IQD <strong>{money(totals.expectedCashIQD)}</strong></span>{usdEnabled && <><span>USD هاتووە ناوەوە <b>{usdMoney(totals.cashInUSD)}</b></span><span>USD چووەتە دەرەوە <b>{usdMoney(totals.cashOutUSD)}</b></span><span>قاسەی USD <strong>{usdMoney(totals.expectedCashUSD)}</strong></span></>}</div>}
      <button className={openShift ? "danger-action" : "toolbar-primary"} type="button" onClick={() => setMode(openShift ? "close" : "open")}>{openShift ? "داخستنی شەفت" : "دەستپێکردنی شەفت"}</button>
    </section>
    {mode && <Modal title={mode === "open" ? "دەستپێکردنی شەفتی کاشێر" : "داخستنی شەفت و ژماردنی قاسە"} onClose={() => setMode(null)}><form className="record-form" onSubmit={(event) => void submit(event)}>{mode === "open" ? <><Field label="پارەی سەرەتای قاسە — IQD"><input name="openingCash" type="number" min="0" defaultValue="0" required autoFocus /></Field>{usdEnabled && <Field label="پارەی سەرەتای قاسە — USD"><input name="openingCashUSD" type="number" min="0" step="0.01" defaultValue="0" required /></Field>}<p className="settings-hint field-wide"><AlertTriangle size={17} />دینار و دۆلار بە جیاوازی بنووسە؛ تەنها پارەی ڕاستەقینەی ناو قاسە.</p></> : <><div className="shift-close-summary field-wide"><span>قاسەی IQD ـی چاوەڕوانکراو</span><strong>{money(totals?.expectedCashIQD ?? 0)}</strong>{usdEnabled && <><span>قاسەی USD ـی چاوەڕوانکراو</span><strong>{usdMoney(totals?.expectedCashUSD ?? 0)}</strong></>}<small>پارەی سەرەتا + هاتووە ناوەوە − چووەتە دەرەوە</small></div><Field label="IQD ـی ژمێردراو"><input name="countedCash" type="number" min="0" defaultValue={totals?.expectedCashIQD ?? 0} required autoFocus /></Field>{usdEnabled && <Field label="USD ـی ژمێردراو"><input name="countedCashUSD" type="number" min="0" step="0.01" defaultValue={totals?.expectedCashUSD ?? 0} required /></Field>}<Field label="تێبینی"><input name="note" placeholder="هۆکاری جیاوازی، ئەگەر هەبوو" /></Field></>}<div className="form-actions"><button className="secondary-action" type="button" onClick={() => setMode(null)}>پاشگەزبوونەوە</button><SubmitButton>{mode === "open" ? "کردنەوەی شەفت" : "داخستنی شەفت"}</SubmitButton></div></form></Modal>}
    {lastClosedShift && <><div className="last-receipt shift-closed-receipt"><div><strong>ڕاپۆرتی داخستنی شەفت</strong><span>{lastClosedShift.operatorName} · {dateTime(lastClosedShift.closedAt ?? lastClosedShift.openedAt)}</span></div><b className={(lastClosedShift.differenceIQD || lastClosedShift.differenceUSD) ? "debt-cell" : ""}>جیاوازی: {money(lastClosedShift.differenceIQD ?? 0)}{usdEnabled ? ` / ${usdMoney(lastClosedShift.differenceUSD ?? 0)}` : ""}</b><button type="button" onClick={printShiftDocument}><Printer size={16} />چاپ</button></div><ShiftReportPaper shift={lastClosedShift} entries={data.cashEntries} settings={data.settings} /></>}
  </>;
}

function Cashier({ data, mutate, onNavigate }: { data: DashboardData; mutate: Mutate; onNavigate: Props["onNavigate"] }) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [customerId, setCustomerId] = useState("");
  const [paid, setPaid] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState<Currency>("IQD");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState("");
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [scanNotice, setScanNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const operator = currentOperator();
  const shiftOpen = data.cashShifts.some((shift) =>
    shift.status === "open" && (shift.deviceId ? shift.deviceId === data.syncMeta.deviceId : shift.operatorId === operator.id),
  );
  const visibleProducts = data.products.filter((product) => `${product.name} ${product.barcode}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  const cartRows = data.products.filter((product) => cart[product.id]).map((product) => ({ product, quantity: cart[product.id], subtotal: product.salePriceIQD * cart[product.id] }));
  const subtotal = cartRows.reduce((sum, row) => sum + row.subtotal, 0);
  const rawDiscount = discountValue === "" ? 0 : Number(discountValue);
  const discountIQD = Number.isFinite(rawDiscount)
    ? Math.round((discountMode === "percent" ? subtotal * rawDiscount / 100 : rawDiscount) * 1000) / 1000
    : 0;
  const discountValid = Number.isFinite(rawDiscount) && rawDiscount >= 0 && (discountMode === "percent" ? rawDiscount <= 100 : discountIQD <= subtotal);
  const total = discountValid ? Math.max(0, subtotal - discountIQD) : subtotal;
  const usdEnabled = data.settings?.usdEnabled ?? false;
  const exchangeRate = configuredUsdRate(data.settings);
  const amountDueInCurrency = convertIQDToCurrency(total, paymentCurrency, exchangeRate);
  const tenderedNumber = paid === "" ? amountDueInCurrency : Number(paid);
  const paymentValid = Number.isFinite(tenderedNumber) && tenderedNumber >= 0;
  const tenderedIQD = paymentValid ? convertCurrencyToIQD(tenderedNumber, paymentCurrency, exchangeRate) : 0;
  const electronicOverpay = paymentMethod !== "cash" && tenderedIQD - total > settlementRoundingToleranceIQD(paymentCurrency, exchangeRate);
  const appliedPaid = Math.min(tenderedIQD, total);
  const changeIQD = paymentMethod === "cash" ? Math.max(0, tenderedIQD - total) : 0;
  const changeAmount = convertIQDToCurrency(changeIQD, paymentCurrency, exchangeRate);
  const debtIQD = Math.max(0, total - appliedPaid);
  const selectedCustomer = data.customers.find((customer) => customer.id === customerId) ?? null;
  const creditLimitIQD = selectedCustomer?.creditLimitIQD ?? 0;
  const projectedBalance = (selectedCustomer?.balanceIQD ?? 0) + debtIQD;
  const creditExceeded = Boolean(selectedCustomer && debtIQD > 0 && creditLimitIQD > 0 && projectedBalance > creditLimitIQD);
  const customerRequired = debtIQD > 0 && !selectedCustomer;
  const quickAmounts = paymentMethod === "cash" && total > 0
    ? [...new Set((paymentCurrency === "USD"
      ? [amountDueInCurrency, Math.ceil(amountDueInCurrency), Math.ceil(amountDueInCurrency / 5) * 5, Math.ceil(amountDueInCurrency / 10) * 10]
      : [amountDueInCurrency, Math.ceil(amountDueInCurrency / 1000) * 1000, Math.ceil(amountDueInCurrency / 5000) * 5000, Math.ceil(amountDueInCurrency / 10000) * 10000]
    ).filter((amount) => amount >= amountDueInCurrency))].slice(0, 4)
    : [];

  useEffect(() => {
    if (!lastSale || !data.settings?.autoPrintAfterSale) return;
    const timer = window.setTimeout(() => window.print(), 180);
    return () => window.clearTimeout(timer);
  }, [data.settings?.autoPrintAfterSale, lastSale]);

  function change(product: Product, delta: number) {
    setCart((current) => {
      const next = Math.round(Math.max(0, Math.min(product.stock, (current[product.id] ?? 0) + delta)) * 1000) / 1000;
      const copy = { ...current };
      if (!next) delete copy[product.id]; else copy[product.id] = next;
      return copy;
    });
  }

  function scan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = normalizeBarcodeInput(query);
    if (!raw) return;
    let quantity = 1;
    let product = data.products.find((item) => item.barcode === raw);
    const settings = data.settings;
    const prefix = settings?.scalePrefix || "27";
    const itemDigits = settings?.scaleItemDigits || 7;
    const decimals = settings?.scaleDecimals ?? 3;

    const scale = parseScaleBarcode(raw, { prefix, itemDigits, decimals });
    if (!product && scale) {
      product = data.products.find((item) => item.barcode === scale.itemCode || item.barcode === scale.shortCode);
      quantity = scale.quantity;
    }

    if (!product) {
      setScanNotice({ kind: "error", text: `بارکۆدی ${raw} نەدۆزرایەوە` });
      return;
    }
    if (quantity <= 0 || (cart[product.id] ?? 0) + quantity > product.stock) {
      setScanNotice({ kind: "error", text: `بڕی ${product.name} لە کۆگا بەس نییە` });
      return;
    }
    change(product, quantity);
    setQuery("");
    setScanNotice({ kind: "ok", text: `${product.name} — ${numberFormatter.format(quantity)} ${product.unit}` });
  }

  async function finish() {
    let completed: Sale | null = null;
    await mutate(async () => {
      completed = await completeSale({ customerId: customerId || null, items: cartRows.map((row) => ({ productId: row.product.id, quantity: row.quantity })), paidAmount: tenderedNumber, paymentCurrency, exchangeRateIQDPerUSD: exchangeRate, paymentMethod, discountIQD });
    }, "فرۆشتن تەواو بوو و کۆگا نوێ کرایەوە");
    if (completed) {
      setLastSale(completed);
      setCart({});
      setPaid("");
      setCustomerId("");
      setPaymentCurrency("IQD");
      setPaymentMethod("cash");
      setDiscountMode("amount");
      setDiscountValue("");
      if (paymentMethod === "cash" && data.settings?.autoOpenCashDrawer) {
        void pulseCashDrawer().catch(() => setScanNotice({ kind: "error", text: "فرۆشتن تۆمارکرا؛ بەڵام قاسە پەیوەست نییە" }));
      }
    }
  }

  if (!data.products.length) return <><Toolbar title="کاشێر" description="فرۆشتن بە بارکۆد و دەرکردنی پسوڵە" /><CashShiftBar data={data} mutate={mutate} /><EmptyState icon={<ShoppingCart size={42} />} title="کالا نییە" text="پێش یەکەم فرۆشتن، کالا و نرخی فرۆشتن تۆمار بکە." action={<button className="toolbar-primary" type="button" onClick={() => onNavigate("products")}><Plus size={17} />زیادکردنی کالا</button>} /></>;
  return <>
    <Toolbar title="کاشێر" description="بارکۆد بسکەنە یان بە ناوی کالا بگەڕێ" />
    <CashShiftBar data={data} mutate={mutate} />
    <div className="cashier-layout">
      <section className="product-picker"><form className="cashier-search" onSubmit={scan}><ScanBarcode size={19} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بارکۆد بسکەنە و Enter بکە..." dir="auto" /><button type="submit">زیادکردن</button></form>{scanNotice && <div className={`scan-notice ${scanNotice.kind}`}>{scanNotice.text}</div>}<div className="product-pick-grid">{visibleProducts.map((product) => <button key={product.id} type="button" disabled={product.stock <= 0} onClick={() => change(product, 1)}><span>{product.name}</span><small>{money(product.salePriceIQD)}</small><i>{numberFormatter.format(product.stock)} {product.unit}</i></button>)}</div></section>
      <section className="cart-panel">
        <header><h4>ناو پسوڵە</h4><span>{numberFormatter.format(cartRows.length)} جۆر</span></header>
        <div className="cart-lines">{!cartRows.length ? <p className="cart-empty">کالا لە لیستەکە هەڵبژێرە</p> : cartRows.map(({ product, quantity, subtotal: lineSubtotal }) => <div className="cart-line" key={product.id}><div><strong>{product.name}</strong><small>{money(product.salePriceIQD)} × {numberFormatter.format(quantity)}</small></div><div className="qty-control"><button type="button" onClick={() => change(product, -1)}><ChevronDown size={15} /></button><span>{numberFormatter.format(quantity)}</span><button type="button" onClick={() => change(product, 1)}><ChevronUp size={15} /></button></div><b>{money(lineSubtotal)}</b></div>)}</div>
        <div className="cart-total"><div><span>کۆی کالا</span><b>{money(subtotal)}</b></div>{discountIQD > 0 && <div className="discount-total"><span>داشکاندن</span><b>− {money(discountIQD)}</b></div>}<div className="cart-net-total"><span>کۆی گشتی</span><strong>{money(total)}</strong>{usdEnabled && <small>{usdMoney(convertIQDToCurrency(total, "USD", exchangeRate))} · 1 USD = {money(exchangeRate)}</small>}</div></div>
        <div className="checkout-fields">
          <Field label="کڕیار"><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">کڕیاری گشتی</option>{data.customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.name} — {money(customer.balanceIQD)}</option>)}</select></Field>
          <Field label="شێوازی پارەدان"><select value={paymentMethod} onChange={(event) => { const method: PaymentMethod = event.target.value === "card" ? "card" : event.target.value === "transfer" ? "transfer" : "cash"; setPaymentMethod(method); setPaid(""); }}><option value="cash">کاش</option><option value="card">کارت</option><option value="transfer">گواستنەوەی بانکی</option></select></Field>
          {usdEnabled && <Field label="دراوی پارەدان"><select value={paymentCurrency} onChange={(event) => { setPaymentCurrency(event.target.value === "USD" ? "USD" : "IQD"); setPaid(""); }}><option value="IQD">IQD — دینار</option><option value="USD">USD — دۆلار</option></select></Field>}
          <Field label="داشکاندن"><div className="discount-control"><select value={discountMode} onChange={(event) => { setDiscountMode(event.target.value === "percent" ? "percent" : "amount"); setDiscountValue(""); }}><option value="amount">IQD</option><option value="percent">%</option></select><input type="number" min="0" max={discountMode === "percent" ? 100 : subtotal} step={discountMode === "percent" ? "0.01" : "1"} value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} placeholder="0" /></div></Field>
          <Field label={`پارەی پێدراو — ${paymentCurrency}`}><input type="number" min="0" max={paymentMethod === "cash" ? undefined : amountDueInCurrency} step={paymentCurrency === "USD" ? "0.01" : "1"} value={paid} onChange={(event) => setPaid(event.target.value)} placeholder={String(amountDueInCurrency)} /></Field>
        </div>
        {quickAmounts.length > 0 && <div className="quick-payments"><span>پارەی خێرا</span>{quickAmounts.map((amount) => <button type="button" key={amount} onClick={() => setPaid(String(amount))}>{currencyMoney(amount, paymentCurrency)}</button>)}</div>}
        <div className="checkout-breakdown"><span><small>پارەی هەژمارکراو</small><b>{money(appliedPaid)}</b></span><span className={debtIQD > 0 ? "debt" : ""}><small>قەرز</small><b>{money(debtIQD)}</b></span><span className={changeIQD > 0 ? "change" : ""}><small>باقی</small><b>{currencyMoney(changeAmount, paymentCurrency)}</b></span></div>
        {selectedCustomer && <div className={creditExceeded ? "customer-credit-state blocked" : "customer-credit-state"}><div><strong>{selectedCustomer.name}</strong><span>قەرزی ئێستا: {money(selectedCustomer.balanceIQD)}</span></div><div><small>{creditLimitIQD > 0 ? "سنووری قەرز" : "سنوور"}</small><b>{creditLimitIQD > 0 ? money(creditLimitIQD) : "بێ سنوور"}</b></div><div><small>دوای ئەم فرۆشتنە</small><b>{money(projectedBalance)}</b></div></div>}
        {!discountValid && <p className="checkout-warning"><AlertTriangle size={15} />داشکاندن نابێت لە کۆی پسوڵە زیاتر بێت.</p>}
        {electronicOverpay && <p className="checkout-warning"><AlertTriangle size={15} />پارەدانی کارت یان گواستنەوە نابێت لە کۆی پسوڵە زیاتر بێت.</p>}
        {customerRequired && <p className="checkout-warning"><AlertTriangle size={15} />بۆ فرۆشتنی قەرز کڕیار هەڵبژێرە.</p>}
        {creditExceeded && <p className="checkout-warning"><AlertTriangle size={15} />ئەم فرۆشتنە سنووری قەرزی کڕیار تێدەپەڕێنێت.</p>}
        <button className="checkout-button" type="button" disabled={!cartRows.length || !shiftOpen || !paymentValid || !discountValid || electronicOverpay || customerRequired || creditExceeded} onClick={() => void finish()}><Check size={18} />{!shiftOpen ? "سەرەتا شەفت بکەرەوە" : creditExceeded ? "سنووری قەرز تێپەڕاوە" : "تەواوکردنی فرۆشتن"}</button>
      </section>
    </div>
    {lastSale && <><div className="last-receipt"><div><strong>پسوڵە {lastSale.receiptNo}</strong><span>{dateTime(lastSale.createdAt)}</span></div><b>{money(lastSale.totalIQD)}</b><button type="button" onClick={() => window.print()}><Printer size={16} />چاپ</button></div><ReceiptPaper sale={lastSale} settings={data.settings} /></>}
  </>;
}

function ReceiptPaper({ sale, settings }: { sale: Sale; settings: PosSettings | null }) {
  const currency: Currency = sale.paymentCurrency === "USD" ? "USD" : "IQD";
  const method = salePaymentMethod(sale);
  const rate = sale.exchangeRateIQDPerUSD ?? configuredUsdRate(settings);
  const tendered = sale.tenderedAmount ?? convertIQDToCurrency(sale.tenderedIQD ?? sale.paidIQD, currency, rate);
  const paid = sale.paidAmount ?? convertIQDToCurrency(sale.paidIQD, currency, rate);
  const change = sale.changeAmount ?? convertIQDToCurrency(sale.changeIQD ?? Math.max(0, (sale.tenderedIQD ?? sale.paidIQD) - sale.totalIQD), currency, rate);
  return <section className={receiptClass(settings)} dir="rtl"><header><h1>{settings?.marketName || "ZHIROX SMART POS"}</h1>{settings?.address && <p>{settings.address}</p>}{settings?.phone && <p dir="ltr">{settings.phone}</p>}</header><div className="receipt-meta"><span>ژمارە: <b dir="ltr">{sale.receiptNo}</b></span><span>{dateTime(sale.createdAt)}</span><span>کڕیار: {sale.customerName}</span><span>پارەدان: {paymentMethodLabel(method)}</span></div><table><thead><tr><th>کالا</th><th>بڕ</th><th>نرخ</th><th>کۆ</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.productId}><td>{item.name}</td><td>{numberFormatter.format(item.quantity)}</td><td>{money(item.unitPriceIQD)}</td><td>{money(item.subtotalIQD)}</td></tr>)}</tbody></table><div className="receipt-totals">{Boolean(sale.discountIQD) && <><p><span>کۆی کالا</span><b>{money(sale.subtotalIQD ?? sale.totalIQD + (sale.discountIQD ?? 0))}</b></p><p><span>داشکاندن</span><b>− {money(sale.discountIQD ?? 0)}</b></p></>}<p><span>کۆی گشتی</span><strong>{money(sale.totalIQD)}</strong></p><p><span>پارەی هەژمارکراو</span><b>{currencyMoney(paid, currency)}</b></p><p><span>پارەی پێدراو</span><b>{currencyMoney(tendered, currency)}</b></p>{change > 0 && <p><span>باقی</span><b>{currencyMoney(change, currency)}</b></p>}{currency === "USD" && <p><span>نرخی گۆڕینەوە</span><b>1 USD = {money(rate)}</b></p>}{sale.debtIQD > 0 && <p><span>قەرز</span><b>{money(sale.debtIQD)}</b></p>}</div>{(settings?.showReceiptBarcode ?? true) && <div className="receipt-code"><BarcodeGraphic value={sale.receiptNo} /><small dir="ltr">{sale.receiptNo}</small></div>}<footer>{settings?.receiptFooter || "سوپاس بۆ کڕینەکەتان"}</footer></section>;
}

function ArchiveFilters({ search, setSearch, from, setFrom, to, setTo, status, setStatus, count }: {
  search: string; setSearch: (value: string) => void; from: string; setFrom: (value: string) => void;
  to: string; setTo: (value: string) => void; status: TransactionStatus; setStatus: (value: TransactionStatus) => void; count: number;
}) {
  const filtered = Boolean(search || from || to || status !== "all");
  return <div className="archive-filters"><label className="archive-search-field"><span>گەڕان</span><div><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ژمارەی پسوڵە، ناو یان بارکۆد..." dir="auto" /></div></label><Field label="لە بەرواری"><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} dir="ltr" /></Field><Field label="تا بەرواری"><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} dir="ltr" /></Field><Field label="دۆخی مامەڵە"><select value={status} onChange={(event) => setStatus(event.target.value as TransactionStatus)}><option value="all">هەموو دۆخەکان</option><option value="completed">تەواو</option><option value="partial">بەشێک گەڕاوەتەوە</option><option value="returned">گەڕاوەتەوە</option></select></Field><button className="secondary-action" type="button" disabled={!filtered} onClick={() => { setSearch(""); setFrom(""); setTo(""); setStatus("all"); }}>پاککردنەوە</button><span className="archive-count">{numberFormatter.format(count)} ئەنجام</span></div>;
}

function SalesPage({ data }: { data: DashboardData }) {
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<TransactionStatus>("all");
  const invalidRange = Boolean(from && to && from > to);
  const normalized = search.trim().toLowerCase();
  const filteredRows = [...data.sales].filter((sale) => {
    const searchable = `${sale.receiptNo} ${sale.customerName} ${sale.items.map((item) => `${item.name} ${item.barcode}`).join(" ")}`.toLowerCase();
    const day = sale.createdAt.slice(0, 10);
    return (!normalized || searchable.includes(normalized)) && (!from || day >= from) && (!to || day <= to) && (status === "all" || sale.status === status);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows = invalidRange ? [] : filteredRows.slice(0, 250);
  const totals = filteredRows.reduce((summary, sale) => ({ total: summary.total + sale.totalIQD, debt: summary.debt + sale.debtIQD, profit: summary.profit + sale.profitIQD }), { total: 0, debt: 0, profit: 0 });

  function exportSalesCsv() {
    if (invalidRange || !filteredRows.length) return;
    const lines: Array<Array<string | number>> = [["پسوڵە", "کڕیار", "کۆی کالا", "داشکاندن", "کۆی گشتی", "پارەی دراو", "شێوازی پارەدان", "قەرز", "قازانج", "دۆخ", "بەروار", "کالا"]];
    filteredRows.forEach((sale) => lines.push([sale.receiptNo, sale.customerName, sale.subtotalIQD ?? sale.totalIQD, sale.discountIQD ?? 0, sale.totalIQD, sale.paidIQD, paymentMethodLabel(salePaymentMethod(sale)), sale.debtIQD, sale.profitIQD, transactionStatusLabel(sale.status), sale.createdAt, sale.items.map((item) => `${item.name} × ${item.quantity}`).join(" | ")]));
    downloadTextFile(`zhirox-sales-${from || "all"}-${to || "all"}.csv`, `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  return <><Toolbar title="ئەرشیفی فرۆش" description="گەڕان، فلتەری بەروار و دۆخ، CSV و دووبارەچاپکردنی پسوڵە" action={<button className="toolbar-primary" type="button" disabled={!filteredRows.length || invalidRange} onClick={exportSalesCsv}><Download size={16} />دەرکردنی CSV</button>} />{data.sales.length > 0 && <ArchiveFilters search={search} setSearch={setSearch} from={from} setFrom={setFrom} to={to} setTo={setTo} status={status} setStatus={setStatus} count={invalidRange ? 0 : filteredRows.length} />}{invalidRange && <p className="purchase-error archive-error">بەرواری دەستپێک نابێت دوای بەرواری کۆتایی بێت.</p>}{data.sales.length > 0 && !invalidRange && <div className="archive-summary"><Metric label="کۆی فرۆش" value={money(totals.total)} /><Metric label="قەرزی ماوە" value={money(totals.debt)} alert={totals.debt > 0} /><Metric label="کۆی قازانج" value={money(totals.profit)} alert={totals.profit < 0} /></div>}{filteredRows.length > rows.length && !invalidRange && <p className="result-limit">لە {numberFormatter.format(filteredRows.length)} ئەنجام، یەکەم {numberFormatter.format(rows.length)} پسوڵە پیشان دەدرێت؛ هەموویان لە CSV دەرئەچن.</p>}{!rows.length ? <EmptyState icon={<FileText size={40} />} title={data.sales.length ? "پسوڵەی هاوتا نەدۆزرایەوە" : "هێشتا فرۆشتن نییە"} text={data.sales.length ? "وشە، بەروار یان دۆخەکە بگۆڕە." : "یەکەم فرۆشتن لە بەشی کاشێر تۆمار دەبێت."} /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>پسوڵە</th><th>کڕیار</th><th>کۆ</th><th>شێوازی پارەدان</th><th>دراو</th><th>قەرز</th><th>قازانج</th><th>دۆخ</th><th>بەروار</th><th>کردار</th></tr></thead><tbody>{rows.map((sale) => <tr key={sale.id}><td dir="ltr">{sale.receiptNo}</td><td>{sale.customerName}</td><td>{money(sale.totalIQD)}{Boolean(sale.discountIQD) && <small className="table-subvalue">داشکاندن: {money(sale.discountIQD ?? 0)}</small>}</td><td><span className={`payment-pill ${salePaymentMethod(sale)}`}>{paymentMethodLabel(salePaymentMethod(sale))}</span></td><td>{sale.paymentCurrency === "USD" ? "USD" : "IQD"}</td><td className={sale.debtIQD > 0 ? "debt-cell" : ""}>{money(sale.debtIQD)}</td><td>{money(sale.profitIQD)}</td><td>{sale.status === "returned" ? <span className="status-pill returned">گەڕاوەتەوە</span> : sale.status === "partial" ? <span className="status-pill partial">بەشێک گەڕاو</span> : <span className="status-pill success">تەواو</span>}</td><td>{dateTime(sale.createdAt)}</td><td><button className="table-action" type="button" onClick={() => setSelectedSale(sale)}><Eye size={14} />بینین</button></td></tr>)}</tbody></table></div>}{selectedSale && <Modal wide title={`پسوڵە ${selectedSale.receiptNo}`} onClose={() => setSelectedSale(null)}><SaleDetail sale={selectedSale} settings={data.settings} /></Modal>}</>;
}

function SaleDetail({ sale, settings }: { sale: Sale; settings: PosSettings | null }) {
  const statusLabel = sale.status === "returned" ? "گەڕاوەتەوە" : sale.status === "partial" ? "بەشێک گەڕاوەتەوە" : "تەواو";
  return <div className="sale-detail"><div className="sale-detail-head"><div><strong>{sale.customerName}</strong><span>{dateTime(sale.createdAt)}</span><small dir="ltr">{sale.receiptNo}</small></div><div className="inline-actions"><span className={`payment-pill ${salePaymentMethod(sale)}`}>{paymentMethodLabel(salePaymentMethod(sale))}</span><span className={`status-pill ${sale.status === "completed" ? "success" : sale.status}`}>{statusLabel}</span><button className="toolbar-primary" type="button" onClick={() => window.print()}><Printer size={16} />دووبارە چاپ</button></div></div><div className="statement-summary"><Metric label="کۆی کالا" value={money(sale.subtotalIQD ?? sale.totalIQD)} /><Metric label="داشکاندن" value={money(sale.discountIQD ?? 0)} /><Metric label="کۆی گشتی" value={money(sale.totalIQD)} /><Metric label="پارەی دراو" value={money(sale.paidIQD)} /><Metric label="قەرز" value={money(sale.debtIQD)} alert={sale.debtIQD > 0} /></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>بارکۆد</th><th>کالا</th><th>بڕ</th><th>نرخی یەکە</th><th>کۆ</th></tr></thead><tbody>{sale.items.map((item) => <tr key={item.productId}><td dir="ltr">{item.barcode}</td><td><strong>{item.name}</strong></td><td>{numberFormatter.format(item.quantity)}</td><td>{money(item.unitPriceIQD)}</td><td>{money(item.subtotalIQD)}</td></tr>)}</tbody></table></div><ReceiptPaper sale={sale} settings={settings} /></div>;
}

function ReturnsPage({ kind, data, mutate }: { kind: "sale" | "purchase"; data: DashboardData; mutate: Mutate }) {
  const isSale = kind === "sale";
  const [selectedSource, setSelectedSource] = useState<Sale | Purchase | null>(null);
  const sources = (isSale ? data.sales : data.purchases).filter((item) => item.status !== "returned");
  const returns = isSale ? data.saleReturns : data.purchaseReturns;
  return <><Toolbar title={isSale ? "گەڕاوی فرۆش" : "گەڕاوی کڕین"} description="هەڵبژاردنی کالا و بڕ؛ کۆگا، قەرز و قاسە خۆکارانە نوێ دەبنەوە" />{!sources.length ? <EmptyState icon={<ArchiveRestore size={40} />} title="پسوڵەی شیاو نییە" text="هیچ مامەڵەیەکی تەواو بۆ گەڕاندنەوە نییە." /> : <div className="return-list">{sources.map((source) => <article key={source.id}><div><strong>{source.receiptNo}</strong><span>{"customerName" in source ? source.customerName : source.supplierName}</span><small>{dateTime(source.createdAt)}</small></div><div className="return-value"><b>{money(source.totalIQD)}</b>{source.status === "partial" && <span className="status-pill partial">بەشێکی گەڕاوەتەوە</span>}</div><button className="danger-action" type="button" onClick={() => setSelectedSource(source)}>هەڵبژاردنی کالا</button></article>)}</div>}<div className="subsection-title"><h4>مێژووی گەڕاوەکان</h4><span>{numberFormatter.format(returns.length)}</span></div>{returns.length > 0 && <div className="data-table-wrap compact"><table className="data-table"><thead><tr><th>پسوڵە</th><th>کالا</th><th>بڕ</th><th>شێوازی پارەدان</th><th>بەروار</th></tr></thead><tbody>{[...returns].reverse().map((item) => { const method = recordPaymentMethod(item); return <tr key={item.id}><td dir="ltr">{item.receiptNo}</td><td>{item.items?.map((row) => row.name).join("، ") || "هەموو پسوڵە"}</td><td>{money(item.totalIQD)}{Boolean(item.discountImpactIQD) && <small className="table-subvalue">پشکی داشکاندن: {money(item.discountImpactIQD ?? 0)}</small>}</td><td><span className={`payment-pill ${method}`}>{paymentMethodLabel(method)}</span></td><td>{dateTime(item.createdAt)}</td></tr>; })}</tbody></table></div>}{selectedSource && <Modal wide title={`گەڕاندنەوەی ${selectedSource.receiptNo}`} onClose={() => setSelectedSource(null)}><ReturnEditor kind={kind} source={selectedSource} returns={returns} mutate={mutate} onDone={() => setSelectedSource(null)} /></Modal>}</>;
}

function ReturnEditor({ kind, source, returns, mutate, onDone }: { kind: "sale" | "purchase"; source: Sale | Purchase; returns: ReturnRecord[]; mutate: Mutate; onDone: () => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const sourceItems = kind === "sale"
    ? (source as Sale).items.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, unitPriceIQD: item.unitPriceIQD }))
    : getPurchaseItems(source as Purchase).map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, unitPriceIQD: item.unitCostIQD }));
  const sourceReturns = returns.filter((item) => item.sourceId === source.id);
  const rows = sourceItems.map((item) => {
    const returned = sourceReturns.reduce((sum, record) => sum + (record.items?.filter((row) => row.productId === item.productId).reduce((value, row) => value + row.quantity, 0) ?? (source.status === "returned" ? item.quantity : 0)), 0);
    return { ...item, returned, remaining: Math.max(0, item.quantity - returned) };
  });
  const selectedQuantity = (productId: string, remaining: number) => Math.min(remaining, Math.max(0, Number(quantities[productId] ?? 0)));
  const grossTotal = rows.reduce((sum, row) => sum + selectedQuantity(row.productId, row.remaining) * row.unitPriceIQD, 0);
  const allSelected = rows.every((row) => row.returned + selectedQuantity(row.productId, row.remaining) >= row.quantity);
  const discountPreview = kind === "sale"
    ? allocateReturnDiscount({
        saleSubtotalIQD: (source as Sale).subtotalIQD ?? (source as Sale).items.reduce((sum, item) => sum + item.subtotalIQD, 0),
        saleDiscountIQD: (source as Sale).discountIQD ?? 0,
        grossReturnIQD: grossTotal,
        priorDiscountIQD: sourceReturns.reduce((sum, item) => sum + (item.discountImpactIQD ?? 0), 0),
        isFinalReturn: allSelected,
      })
    : { grossTotalIQD: grossTotal, discountImpactIQD: 0, totalIQD: grossTotal };
  const total = discountPreview.totalIQD;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const items = rows.map((row) => ({ productId: row.productId, quantity: Number(quantities[row.productId] ?? 0) })).filter((row) => row.quantity > 0);
    const completed = await mutate(() => kind === "sale" ? returnSale(source.id, items) : returnPurchase(source.id, items), "کالا گەڕێندرایەوە و کۆگا، قەرز و قاسە نوێ کرانەوە");
    if (completed) onDone();
  }

  return <form className="return-editor" onSubmit={(event) => void submit(event)}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>کالا</th><th>بڕی پسوڵە</th><th>پێشتر گەڕاو</th><th>ماوە</th><th>بڕی ئێستا</th><th>بەها</th></tr></thead><tbody>{rows.map((row) => <tr key={row.productId}><td><strong>{row.name}</strong></td><td>{numberFormatter.format(row.quantity)}</td><td>{numberFormatter.format(row.returned)}</td><td>{numberFormatter.format(row.remaining)}</td><td><input aria-label={`بڕی گەڕاوەی ${row.name}`} value={quantities[row.productId] ?? ""} onChange={(event) => setQuantities((old) => ({ ...old, [row.productId]: event.target.value }))} type="number" min="0" max={row.remaining} step="0.001" disabled={row.remaining <= 0} /></td><td>{money(selectedQuantity(row.productId, row.remaining) * row.unitPriceIQD)}</td></tr>)}</tbody></table></div><div className="return-editor-footer"><div><span>کۆی گەڕاندنەوە</span>{discountPreview.discountImpactIQD > 0 && <small>کۆی کالا {money(grossTotal)} · پشکی داشکاندن − {money(discountPreview.discountImpactIQD)}</small>}<strong>{money(total)}</strong></div><div className="inline-actions"><button className="secondary-action" type="button" onClick={onDone}>پاشگەزبوونەوە</button><button className="danger-action" type="submit" disabled={grossTotal <= 0}>پەسەندکردنی گەڕاندنەوە</button></div></div></form>;
}

function PurchasesPage({ data, mutate, onNavigate }: { data: DashboardData; mutate: Mutate; onNavigate: Props["onNavigate"] }) {
  const [supplierId, setSupplierId] = useState(data.suppliers[0]?.id ?? "");
  const [productId, setProductId] = useState(data.products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("1");
  const [unitCost, setUnitCost] = useState(String(data.products[0]?.purchasePriceIQD ?? 0));
  const [paid, setPaid] = useState("0");
  const [paymentCurrency, setPaymentCurrency] = useState<Currency>("IQD");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [lines, setLines] = useState<Array<{ productId: string; quantity: number; unitCostIQD: number }>>([]);
  const [lineError, setLineError] = useState("");
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveFrom, setArchiveFrom] = useState("");
  const [archiveTo, setArchiveTo] = useState("");
  const [archiveStatus, setArchiveStatus] = useState<TransactionStatus>("all");
  const total = lines.reduce((sum, line) => sum + line.quantity * line.unitCostIQD, 0);
  const usdEnabled = data.settings?.usdEnabled ?? false;
  const exchangeRate = configuredUsdRate(data.settings);
  const paidNumber = Number(paid || 0);
  const paidIQD = Number.isFinite(paidNumber) ? convertCurrencyToIQD(Math.max(0, paidNumber), paymentCurrency, exchangeRate) : Number.NaN;
  const paymentOver = Number.isFinite(paidIQD) && paidIQD - total > settlementRoundingToleranceIQD(paymentCurrency, exchangeRate);
  const invalidRange = Boolean(archiveFrom && archiveTo && archiveFrom > archiveTo);
  const normalizedSearch = archiveSearch.trim().toLowerCase();
  const filteredPurchases = [...data.purchases].filter((purchase) => {
    const items = getPurchaseItems(purchase);
    const searchable = `${purchase.receiptNo} ${purchase.supplierName} ${items.map((item) => `${item.name} ${item.barcode}`).join(" ")}`.toLowerCase();
    const day = purchase.createdAt.slice(0, 10);
    return (!normalizedSearch || searchable.includes(normalizedSearch)) && (!archiveFrom || day >= archiveFrom) && (!archiveTo || day <= archiveTo) && (archiveStatus === "all" || purchase.status === archiveStatus);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visiblePurchases = invalidRange ? [] : filteredPurchases.slice(0, 250);
  const archiveTotals = filteredPurchases.reduce((summary, purchase) => ({ total: summary.total + purchase.totalIQD, paid: summary.paid + purchase.paidIQD, debt: summary.debt + purchase.debtIQD }), { total: 0, paid: 0, debt: 0 });

  function addLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const product = data.products.find((item) => item.id === productId);
    const nextQuantity = Number(quantity);
    const nextCost = Number(unitCost);
    if (!product || !Number.isFinite(nextQuantity) || nextQuantity <= 0 || !Number.isFinite(nextCost) || nextCost < 0) { setLineError("کالا، بڕ و نرخ بە دروستی بنووسە"); return; }
    setLines((old) => {
      const existing = old.find((item) => item.productId === product.id);
      if (!existing) return [...old, { productId: product.id, quantity: nextQuantity, unitCostIQD: nextCost }];
      return old.map((item) => item.productId === product.id ? { ...item, quantity: item.quantity + nextQuantity, unitCostIQD: nextCost } : item);
    });
    setQuantity("1");
    setLineError("");
  }

  async function finishPurchase() {
    const saved = await mutate(() => completePurchase({ supplierId, items: lines, paidAmount: Number(paid), paymentCurrency, exchangeRateIQDPerUSD: exchangeRate, paymentMethod }), "پسوڵەی کڕین تۆمارکرا و هەموو کاڵاکان زیاد کران");
    if (saved) { setLines([]); setPaid("0"); setPaymentCurrency("IQD"); setPaymentMethod("cash"); }
  }

  function exportPurchasesCsv() {
    if (invalidRange || !filteredPurchases.length) return;
    const linesForCsv: Array<Array<string | number>> = [["پسوڵە", "دابینکەر", "ژمارەی جۆر", "کۆی بڕ", "کۆی گشتی", "پارەی دراو", "شێوازی پارەدان", "قەرز", "دۆخ", "بەروار", "کالا"]];
    filteredPurchases.forEach((purchase) => {
      const items = getPurchaseItems(purchase);
      linesForCsv.push([purchase.receiptNo, purchase.supplierName, items.length, items.reduce((sum, item) => sum + item.quantity, 0), purchase.totalIQD, purchase.paidIQD, paymentMethodLabel(recordPaymentMethod(purchase)), purchase.debtIQD, transactionStatusLabel(purchase.status), purchase.createdAt, items.map((item) => `${item.name} × ${item.quantity}`).join(" | ")]);
    });
    downloadTextFile(`zhirox-purchases-${archiveFrom || "all"}-${archiveTo || "all"}.csv`, `\uFEFF${linesForCsv.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  if (!data.products.length || !data.suppliers.length) return <><Toolbar title="کڕین" description="پسولەی کڕین و زیادکردنی خۆکاری کۆگا" /><EmptyState icon={<PackagePlus size={40} />} title="زانیاری سەرەتایی تەواو نییە" text="بۆ تۆمارکردنی کڕین، لانیکەم یەک کالا و یەک دابینکەر پێویستە." action={<div className="inline-actions"><button className="toolbar-primary" onClick={() => onNavigate("products")} type="button">کالا</button><button className="secondary-action" onClick={() => onNavigate("suppliers")} type="button">دابینکەر</button></div>} /></>;
  return <>
    <Toolbar title="تۆمارکردن و ئەرشیفی کڕین" description="چەندین کالا لە یەک پسوڵەدا، گەڕان و دەرکردنی CSV" action={<button className="toolbar-primary" type="button" disabled={!filteredPurchases.length || invalidRange} onClick={exportPurchasesCsv}><Download size={16} />دەرکردنی CSV</button>} />
    <section className="purchase-builder"><div className="purchase-party"><Field label="دابینکەر"><select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{data.suppliers.map((item) => <option key={item.id} value={item.id}>{item.name} — {money(item.balanceIQD)}</option>)}</select></Field></div><form className="purchase-line-form" onSubmit={addLine}><Field label="کالا"><select value={productId} onChange={(event) => { const next = data.products.find((item) => item.id === event.target.value); setProductId(event.target.value); setUnitCost(String(next?.purchasePriceIQD ?? 0)); }}>{data.products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="بڕ"><input value={quantity} onChange={(event) => setQuantity(event.target.value)} type="number" min="0.001" step="0.001" required /></Field><Field label="نرخی یەکە"><input value={unitCost} onChange={(event) => setUnitCost(event.target.value)} type="number" min="0" required /></Field><button className="toolbar-primary" type="submit"><Plus size={16} />زیادکردن بۆ پسوڵە</button></form>{lineError && <p className="purchase-error">{lineError}</p>}<div className="purchase-lines">{!lines.length ? <p>هێشتا کالا بۆ پسوڵە زیاد نەکراوە.</p> : lines.map((line) => { const product = data.products.find((item) => item.id === line.productId); return <article key={line.productId}><div><strong>{product?.name || "کالا"}</strong><span dir="ltr">{product?.barcode}</span></div><span>{numberFormatter.format(line.quantity)} × {money(line.unitCostIQD)}</span><b>{money(line.quantity * line.unitCostIQD)}</b><button type="button" aria-label={`سڕینەوەی ${product?.name}`} onClick={() => setLines((old) => old.filter((item) => item.productId !== line.productId))}><X size={15} /></button></article>; })}</div><div className="purchase-checkout"><div><span>کۆی پسوڵە</span><strong>{money(total)}</strong>{usdEnabled && <small>{usdMoney(convertIQDToCurrency(total, "USD", exchangeRate))}</small>}</div><Field label="شێوازی پارەدان"><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value === "card" ? "card" : event.target.value === "transfer" ? "transfer" : "cash")}><option value="cash">کاش</option><option value="card">کارت</option><option value="transfer">گواستنەوەی بانکی</option></select></Field>{usdEnabled && <Field label="دراوی پارەدان"><select value={paymentCurrency} onChange={(event) => { setPaymentCurrency(event.target.value === "USD" ? "USD" : "IQD"); setPaid("0"); }}><option value="IQD">IQD — دینار</option><option value="USD">USD — دۆلار</option></select></Field>}<Field label={`پارەی دراو — ${paymentCurrency}`}><input value={paid} onChange={(event) => setPaid(event.target.value)} type="number" min="0" step={paymentCurrency === "USD" ? "0.01" : "1"} max={convertIQDToCurrency(total, paymentCurrency, exchangeRate)} /></Field><div><span>قەرز</span><strong>{money(Math.max(0, total - (Number.isFinite(paidIQD) ? Math.min(paidIQD, total) : 0)))}</strong></div><button className="checkout-button" type="button" disabled={!lines.length || !Number.isFinite(paidIQD) || paymentOver} onClick={() => void finishPurchase()}><Check size={17} />تەواوکردنی پسوڵە</button></div></section>
    <div className="subsection-title"><h4>ئەرشیفی کڕینەکان</h4><span>{numberFormatter.format(data.purchases.length)}</span></div>
    {data.purchases.length > 0 && <ArchiveFilters search={archiveSearch} setSearch={setArchiveSearch} from={archiveFrom} setFrom={setArchiveFrom} to={archiveTo} setTo={setArchiveTo} status={archiveStatus} setStatus={setArchiveStatus} count={invalidRange ? 0 : filteredPurchases.length} />}
    {invalidRange && <p className="purchase-error archive-error">بەرواری دەستپێک نابێت دوای بەرواری کۆتایی بێت.</p>}
    {data.purchases.length > 0 && !invalidRange && <div className="archive-summary"><Metric label="کۆی کڕین" value={money(archiveTotals.total)} /><Metric label="پارەی دراو" value={money(archiveTotals.paid)} /><Metric label="قەرزی ماوە" value={money(archiveTotals.debt)} alert={archiveTotals.debt > 0} /></div>}
    {filteredPurchases.length > visiblePurchases.length && !invalidRange && <p className="result-limit">لە {numberFormatter.format(filteredPurchases.length)} ئەنجام، یەکەم {numberFormatter.format(visiblePurchases.length)} پسوڵە پیشان دەدرێت؛ هەموویان لە CSV دەرئەچن.</p>}
    {!visiblePurchases.length ? <EmptyState icon={<PackagePlus size={40} />} title={data.purchases.length ? "پسوڵەی هاوتا نەدۆزرایەوە" : "هێشتا کڕین نییە"} text={data.purchases.length ? "وشە، بەروار یان دۆخەکە بگۆڕە." : "یەکەم پسوڵەی کڕین لە سەرەوە تۆمار بکە."} /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>پسوڵە</th><th>دابینکەر</th><th>کالا</th><th>بڕ</th><th>کۆ</th><th>دراو</th><th>شێوازی پارەدان</th><th>قەرز</th><th>دۆخ</th><th>بەروار</th><th>کردار</th></tr></thead><tbody>{visiblePurchases.map((item) => { const items = getPurchaseItems(item); const method = recordPaymentMethod(item); return <tr key={item.id}><td dir="ltr">{item.receiptNo}</td><td>{item.supplierName}</td><td>{items.length} جۆر</td><td>{numberFormatter.format(items.reduce((sum, row) => sum + row.quantity, 0))}</td><td>{money(item.totalIQD)}</td><td>{money(item.paidIQD)}</td><td><span className={`payment-pill ${method}`}>{paymentMethodLabel(method)}</span></td><td className={item.debtIQD > 0 ? "debt-cell" : ""}>{money(item.debtIQD)}</td><td>{item.status === "returned" ? <span className="status-pill returned">گەڕاوەتەوە</span> : item.status === "partial" ? <span className="status-pill partial">بەشێک گەڕاو</span> : <span className="status-pill success">تەواو</span>}</td><td>{dateTime(item.createdAt)}</td><td><button className="table-action" type="button" onClick={() => setSelectedPurchase(item)}><Eye size={14} />بینین</button></td></tr>; })}</tbody></table></div>}
    {selectedPurchase && <Modal wide title={`پسوڵەی کڕین ${selectedPurchase.receiptNo}`} onClose={() => setSelectedPurchase(null)}><PurchaseDetail purchase={selectedPurchase} settings={data.settings} /></Modal>}
  </>;
}

function PurchaseDetail({ purchase, settings }: { purchase: Purchase; settings: PosSettings | null }) {
  const items = getPurchaseItems(purchase);
  const method = recordPaymentMethod(purchase);
  const statusLabel = purchase.status === "returned" ? "گەڕاوەتەوە" : purchase.status === "partial" ? "بەشێک گەڕاوەتەوە" : "تەواو";
  return <div className="sale-detail"><div className="sale-detail-head"><div><strong>{purchase.supplierName}</strong><span>{dateTime(purchase.createdAt)}</span><small dir="ltr">{purchase.receiptNo}</small></div><div className="inline-actions"><span className={`payment-pill ${method}`}>{paymentMethodLabel(method)}</span><span className={`status-pill ${purchase.status === "completed" ? "success" : purchase.status}`}>{statusLabel}</span><button className="toolbar-primary" type="button" onClick={() => window.print()}><Printer size={16} />چاپی پسوڵە</button></div></div><div className="statement-summary"><Metric label="کۆی گشتی" value={money(purchase.totalIQD)} /><Metric label="پارەی دراو" value={money(purchase.paidIQD)} /><Metric label="قەرز" value={money(purchase.debtIQD)} alert={purchase.debtIQD > 0} /></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>بارکۆد</th><th>کالا</th><th>بڕ</th><th>نرخی یەکە</th><th>کۆ</th></tr></thead><tbody>{items.map((item) => <tr key={item.productId}><td dir="ltr">{item.barcode || "—"}</td><td><strong>{item.name}</strong></td><td>{numberFormatter.format(item.quantity)}</td><td>{money(item.unitCostIQD)}</td><td>{money(item.subtotalIQD)}</td></tr>)}</tbody></table></div><PurchaseReceiptPaper purchase={purchase} settings={settings} /></div>;
}

function PurchaseReceiptPaper({ purchase, settings }: { purchase: Purchase; settings: PosSettings | null }) {
  const items = getPurchaseItems(purchase);
  const currency: Currency = purchase.paymentCurrency === "USD" ? "USD" : "IQD";
  const rate = purchase.exchangeRateIQDPerUSD ?? configuredUsdRate(settings);
  const method = recordPaymentMethod(purchase);
  const paidAmount = purchase.paidAmount ?? convertIQDToCurrency(purchase.paidIQD, currency, rate);
  return <section className={receiptClass(settings)} dir="rtl"><header><h1>{settings?.marketName || "ZHIROX SMART POS"}</h1><p>پسوڵەی کڕین</p>{settings?.address && <p>{settings.address}</p>}{settings?.phone && <p dir="ltr">{settings.phone}</p>}</header><div className="receipt-meta"><span>ژمارە: <b dir="ltr">{purchase.receiptNo}</b></span><span>{dateTime(purchase.createdAt)}</span><span>دابینکەر: {purchase.supplierName}</span><span>پارەدان: {paymentMethodLabel(method)}</span></div><table><thead><tr><th>کالا</th><th>بڕ</th><th>نرخ</th><th>کۆ</th></tr></thead><tbody>{items.map((item) => <tr key={item.productId}><td>{item.name}</td><td>{numberFormatter.format(item.quantity)}</td><td>{money(item.unitCostIQD)}</td><td>{money(item.subtotalIQD)}</td></tr>)}</tbody></table><div className="receipt-totals"><p><span>کۆی گشتی</span><strong>{money(purchase.totalIQD)}</strong></p><p><span>پارەی دراو</span><b>{currencyMoney(paidAmount, currency)}</b></p>{currency === "USD" && <p><span>نرخی گۆڕینەوە</span><b>1 USD = {money(rate)}</b></p>}{purchase.debtIQD > 0 && <p><span>قەرز</span><b>{money(purchase.debtIQD)}</b></p>}</div>{(settings?.showReceiptBarcode ?? true) && <div className="receipt-code"><BarcodeGraphic value={purchase.receiptNo} /><small dir="ltr">{purchase.receiptNo}</small></div>}<footer>بەڵگەی کڕینی {settings?.marketName || "Zhirox Smart POS"}</footer></section>;
}

function ExpensePage({ data, formOpen, setFormOpen, mutate }: { data: DashboardData; formOpen: boolean; setFormOpen: (v: boolean) => void; mutate: Mutate }) {
  const usdEnabled = data.settings?.usdEnabled ?? false;
  const rate = configuredUsdRate(data.settings);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const currency: Currency = usdEnabled && form.get("currency") === "USD" ? "USD" : "IQD";
    const paymentMethod: PaymentMethod = form.get("paymentMethod") === "card" ? "card" : form.get("paymentMethod") === "transfer" ? "transfer" : "cash";
    const amountOriginal = Number(form.get("amount"));
    const item: Expense = {
      id: createId("expense"), category: String(form.get("category")),
      amountIQD: convertCurrencyToIQD(amountOriginal, currency, rate), currency, amountOriginal,
      exchangeRateIQDPerUSD: currency === "USD" ? rate : undefined, paymentMethod,
      note: String(form.get("note") ?? ""), createdAt: new Date().toISOString(),
    };
    if (await mutate(() => recordExpense(item), "خەرجی تۆمارکرا و حسابی پارەدان نوێ کرایەوە")) target.reset();
  }
  return <><Toolbar title="خەرجییەکان" description="کرێ، کارەبا، مووچە و خەرجی ڕۆژانە بە دینار یان دۆلار" action={<button className="toolbar-primary" type="button" onClick={() => setFormOpen(true)}><Plus size={17} />خەرجی</button>} />{!data.expenses.length ? <EmptyState icon={<FileText size={40} />} title="خەرجی نییە" text="هێشتا هیچ خەرجییەک تۆمار نەکراوە." /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>جۆر</th><th>بڕی پارەدان</th><th>شێوازی پارەدان</th><th>بنەمای IQD</th><th>تێبینی</th><th>بەروار</th></tr></thead><tbody>{[...data.expenses].reverse().map((item) => { const currency: Currency = item.currency === "USD" ? "USD" : "IQD"; const original = item.amountOriginal ?? convertIQDToCurrency(item.amountIQD, currency, item.exchangeRateIQDPerUSD ?? rate); const method = recordPaymentMethod(item); return <tr key={item.id}><td><strong>{item.category}</strong></td><td>{currencyMoney(original, currency)}</td><td><span className={`payment-pill ${method}`}>{paymentMethodLabel(method)}</span></td><td>{money(item.amountIQD)}</td><td>{item.note || "—"}</td><td>{dateTime(item.createdAt)}</td></tr>; })}</tbody></table></div>}{formOpen && <Modal title="تۆمارکردنی خەرجی" onClose={() => setFormOpen(false)}><form className="record-form" onSubmit={(event) => void submit(event)}><Field label="جۆری خەرجی"><select name="category"><option>کرێ</option><option>کارەبا</option><option>مووچە</option><option>گواستنەوە</option><option>هی تر</option></select></Field><Field label="شێوازی پارەدان"><select name="paymentMethod" defaultValue="cash"><option value="cash">کاش</option><option value="card">کارت</option><option value="transfer">گواستنەوەی بانکی</option></select></Field>{usdEnabled && <Field label="دراوی پارەدان"><select name="currency" defaultValue="IQD"><option value="IQD">IQD — دینار</option><option value="USD">USD — دۆلار</option></select></Field>}<Field label="بڕ"><input name="amount" type="number" min="0.01" step="0.01" required /></Field>{usdEnabled && <p className="settings-hint field-wide">نرخی تۆمارکراو: 1 USD = {money(rate)}؛ هەژماری بنەڕەتی بە IQD دەمێنێتەوە.</p>}<Field label="تێبینی" wide><textarea name="note" rows={3} /></Field><div className="form-actions"><button className="secondary-action" type="button" onClick={() => setFormOpen(false)}>پاشگەزبوونەوە</button><SubmitButton /></div></form></Modal>}</>;
}

function CashPage({ direction, data, mutate }: { direction: "in" | "out"; data: DashboardData; mutate: Mutate }) {
  const people = direction === "in" ? data.customers : data.suppliers;
  const usdEnabled = data.settings?.usdEnabled ?? false;
  const rate = configuredUsdRate(data.settings);
  const [lastEntry, setLastEntry] = useState<CashEntry | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<CashEntry | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = event.currentTarget;
    const form = new FormData(target);
    const partyId = String(form.get("partyId") ?? "");
    const person = people.find((item) => item.id === partyId);
    const currency: Currency = usdEnabled && form.get("currency") === "USD" ? "USD" : "IQD";
    const paymentMethod: PaymentMethod = form.get("paymentMethod") === "card" ? "card" : form.get("paymentMethod") === "transfer" ? "transfer" : "cash";
    const amountOriginal = Number(form.get("amount"));
    const entry: CashEntry = {
      id: createId("cash"),
      receiptNo: await createReceiptNo(direction === "in" ? "W" : "D"),
      direction,
      reason: direction === "in" ? "پارەوەرگرتن" : "پارەدان",
      partyType: partyId ? (direction === "in" ? "customer" : "supplier") : "other",
      partyId: partyId || null,
      partyName: person?.name ?? "هی تر",
      amountIQD: convertCurrencyToIQD(amountOriginal, currency, rate),
      currency,
      amountOriginal,
      exchangeRateIQDPerUSD: currency === "USD" ? rate : undefined,
      paymentMethod,
      note: String(form.get("note") ?? "").trim(),
      createdAt: new Date().toISOString(),
    };
    let completed: CashEntry | null = null;
    const saved = await mutate(async () => { completed = await recordCashEntry(entry); }, direction === "in" ? "پارە وەرگیرا، قەرز نوێ کرایەوە و وەسل دروستکرا" : "پارەدان تۆمارکرا و وەسل دروستکرا");
    if (saved && completed) {
      target.reset();
      setSelectedEntry(null);
      setLastEntry(completed);
    }
  }

  const rows = data.cashEntries.filter((entry) => entry.direction === direction).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 250);
  const currentBalance = (entry: CashEntry) => entry.partyId ? people.find((person) => person.id === entry.partyId)?.balanceIQD ?? null : null;
  return <>
    <Toolbar title={direction === "in" ? "پارەوەرگرتن" : "پارەدان"} description={direction === "in" ? "وەرگرتنی قەرزی کڕیار و دەرکردنی وەسلی فەرمی" : "پارەدان بە دابینکەر و دەرکردنی وەسلی فەرمی"} />
    <form className="inline-form-card treasury-form" onSubmit={(event) => void submit(event)}><Field label={direction === "in" ? "کڕیار" : "دابینکەر"}><select name="partyId"><option value="">هی تر</option>{people.map((item) => <option key={item.id} value={item.id}>{item.name} — {money(item.balanceIQD)}</option>)}</select></Field><Field label="شێوازی پارەدان"><select name="paymentMethod" defaultValue="cash"><option value="cash">کاش</option><option value="card">کارت</option><option value="transfer">گواستنەوەی بانکی</option></select></Field>{usdEnabled && <Field label="دراو"><select name="currency" defaultValue="IQD"><option value="IQD">IQD — دینار</option><option value="USD">USD — دۆلار</option></select></Field>}<Field label="بڕ"><input name="amount" type="number" min="0.01" step="0.01" required /></Field><Field label="تێبینی"><input name="note" placeholder="هۆکار یان ژمارەی بەڵگە" /></Field><SubmitButton>{direction === "in" ? "وەرگرتن" : "پارەدان"}</SubmitButton></form>
    {usdEnabled && <p className="settings-hint">نرخی تۆمارکراو: 1 USD = {money(rate)}؛ قەرز و ژمێریاری بە IQD نوێ دەکرێنەوە.</p>}
    {lastEntry && <><div className="last-receipt"><div><strong>{direction === "in" ? "وەسلی پارەوەرگرتن" : "وەسلی پارەدان"} — {cashReceiptNo(lastEntry)}</strong><span>{lastEntry.partyName} · {dateTime(lastEntry.createdAt)}</span></div><b>{entrySettlementMoney(lastEntry)}</b><button type="button" onClick={() => window.print()}><Printer size={16} />چاپ</button></div><CashReceiptPaper entry={lastEntry} settings={data.settings} balance={currentBalance(lastEntry)} /></>}
    {rows.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>وەسل</th><th>کەس</th><th>هۆکار</th><th>بڕی ڕاستەقینە</th><th>شێوازی پارەدان</th><th>بنەمای IQD</th><th>تێبینی</th><th>بەروار</th><th>کردار</th></tr></thead><tbody>{rows.map((item) => { const method = recordPaymentMethod(item); return <tr key={item.id}><td dir="ltr">{cashReceiptNo(item)}</td><td><strong>{item.partyName}</strong></td><td>{item.reason}</td><td>{entrySettlementMoney(item)}</td><td><span className={`payment-pill ${method}`}>{paymentMethodLabel(method)}</span></td><td>{money(item.amountIQD)}</td><td>{item.note || "—"}</td><td>{dateTime(item.createdAt)}</td><td><button className="table-action" type="button" onClick={() => { setLastEntry(null); setSelectedEntry(item); }}><Eye size={14} />بینین</button></td></tr>; })}</tbody></table></div>}
    {selectedEntry && <Modal title={`${direction === "in" ? "وەسلی پارەوەرگرتن" : "وەسلی پارەدان"} ${cashReceiptNo(selectedEntry)}`} onClose={() => setSelectedEntry(null)}><CashEntryDetail entry={selectedEntry} settings={data.settings} balance={currentBalance(selectedEntry)} /></Modal>}
  </>;
}

function cashReceiptNo(entry: CashEntry) {
  if (entry.receiptNo) return entry.receiptNo;
  if (/^[FKWD]-\d/.test(entry.note)) return entry.note;
  return `C-${entry.id.slice(-8).toUpperCase()}`;
}

function CashEntryDetail({ entry, settings, balance }: { entry: CashEntry; settings: PosSettings | null; balance: number | null }) {
  const currency = cashEntryCurrency(entry);
  const method = recordPaymentMethod(entry);
  return <div className="cash-receipt-detail"><div className="cash-receipt-summary"><span>{entry.direction === "in" ? "پارە لە" : "پارە بۆ"}</span><strong>{entry.partyName}</strong><b>{entrySettlementMoney(entry)}</b><span className={`payment-pill ${method}`}>{paymentMethodLabel(method)}</span>{currency === "USD" && <small>بنەمای ژمێریاری: {money(entry.amountIQD)} · 1 USD = {money(entry.exchangeRateIQDPerUSD ?? configuredUsdRate(settings))}</small>}{balance !== null && <small>قەرزی ئێستا: {money(balance)}</small>}</div>{entry.note && <p className="settings-hint">تێبینی: {entry.note}</p>}<div className="form-actions"><button className="toolbar-primary" type="button" onClick={() => window.print()}><Printer size={16} />چاپی وەسل</button></div><CashReceiptPaper entry={entry} settings={settings} balance={balance} /></div>;
}

function CashReceiptPaper({ entry, settings, balance }: { entry: CashEntry; settings: PosSettings | null; balance: number | null }) {
  const receiptNo = cashReceiptNo(entry);
  const currency = cashEntryCurrency(entry);
  const method = recordPaymentMethod(entry);
  return <section className={receiptClass(settings)} dir="rtl"><header><h1>{settings?.marketName || "ZHIROX SMART POS"}</h1><p>{entry.direction === "in" ? "وەسلی پارەوەرگرتن" : "وەسلی پارەدان"}</p>{settings?.address && <p>{settings.address}</p>}{settings?.phone && <p dir="ltr">{settings.phone}</p>}</header><div className="receipt-meta"><span>ژمارە: <b dir="ltr">{receiptNo}</b></span><span>{dateTime(entry.createdAt)}</span><span>{entry.direction === "in" ? "لە بەڕێز:" : "بۆ بەڕێز:"} <b>{entry.partyName}</b></span><span>شێوازی پارەدان: {paymentMethodLabel(method)}</span></div><div className="cash-receipt-amount"><span>بڕی پارە</span><strong>{entrySettlementMoney(entry)}</strong></div><table><tbody><tr><th>هۆکار</th><td>{entry.reason}</td></tr>{currency === "USD" && <><tr><th>بنەمای IQD</th><td>{money(entry.amountIQD)}</td></tr><tr><th>نرخی گۆڕینەوە</th><td>1 USD = {money(entry.exchangeRateIQDPerUSD ?? configuredUsdRate(settings))}</td></tr></>}<tr><th>تێبینی</th><td>{entry.note || "—"}</td></tr>{balance !== null && <tr><th>قەرزی ئێستا</th><td>{money(balance)}</td></tr>}</tbody></table>{(settings?.showReceiptBarcode ?? true) && <div className="receipt-code"><BarcodeGraphic value={receiptNo} /><small dir="ltr">{receiptNo}</small></div>}<div className="receipt-signatures"><span>واژۆی وەرگر</span><span>واژۆی پارەدەر</span></div><footer>{settings?.receiptFooter || "سوپاس"}</footer></section>;
}

function LossPage({ data, mutate, onNavigate }: { data: DashboardData; mutate: Mutate; onNavigate: Props["onNavigate"] }) {
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const target = event.currentTarget; const form = new FormData(target); if (await mutate(() => recordLoss({ productId: String(form.get("productId")), quantity: Number(form.get("quantity")), reason: String(form.get("reason")) }), "خەساربوو تۆمارکرا و کۆگا کەم کرایەوە")) target.reset(); }
  if (!data.products.length) return <><Toolbar title="خەساربوو" description="کالای تێکچوو یان بەسەرچوو" /><EmptyState icon={<AlertTriangle size={40} />} title="کالا نییە" text="پێش تۆمارکردنی خەسار، کالا زیاد بکە." action={<button className="toolbar-primary" type="button" onClick={() => onNavigate("products")}>کالا</button>} /></>;
  return <><Toolbar title="خەساربوو" description="تێکچوو، بەسەرچوو، ونبوو و کەمبووی کۆگا" /><form className="inline-form-card" onSubmit={(event) => void submit(event)}><Field label="کالا"><select name="productId">{data.products.map((item) => <option value={item.id} key={item.id}>{item.name} — {numberFormatter.format(item.stock)}</option>)}</select></Field><Field label="بڕ"><input name="quantity" type="number" min="0.001" step="0.001" required /></Field><Field label="هۆکار"><select name="reason"><option>بەسەرچوو</option><option>تێکچوو</option><option>ونبوو</option><option>کەمبوو</option></select></Field><SubmitButton>تۆمارکردن</SubmitButton></form>{data.losses.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>کالا</th><th>بڕ</th><th>تێچوو</th><th>هۆکار</th><th>بەروار</th></tr></thead><tbody>{[...data.losses].reverse().map((item) => <tr key={item.id}><td>{item.productName}</td><td>{numberFormatter.format(item.quantity)}</td><td>{money(item.costIQD)}</td><td>{item.reason}</td><td>{dateTime(item.createdAt)}</td></tr>)}</tbody></table></div>}</>;
}

function accountTypeLabel(type: LedgerAccount["type"]) {
  return { asset: "سامان", liability: "قەرز/پابەندی", equity: "سەرمایە", income: "داهات", expense: "خەرجی" }[type];
}

function AccountsPage({ data, formOpen, setFormOpen, mutate }: { data: DashboardData; formOpen: boolean; setFormOpen: (value: boolean) => void; mutate: Mutate }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<LedgerAccount | null>(null);
  const rows = [...data.accounts].filter((account) => `${account.code} ${account.name} ${account.note}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => a.code.localeCompare(b.code));
  const activeCount = data.accounts.filter((account) => account.active).length;
  const totalOpening = data.accounts.reduce((sum, account) => sum + account.openingBalanceIQD, 0);

  async function submit(event: FormEvent<HTMLFormElement>, current: LedgerAccount | null) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const code = String(form.get("code") ?? "").trim();
    const account: LedgerAccount = {
      id: current?.id ?? createId("account"), code, name,
      type: String(form.get("type")) as LedgerAccount["type"],
      openingBalanceIQD: Number(form.get("openingBalance") ?? 0),
      note: String(form.get("note") ?? "").trim(), active: current ? form.get("active") === "on" : true,
      createdAt: current?.createdAt ?? new Date().toISOString(),
    };
    const saved = await mutate(async () => {
      if (!name || !code) throw new Error("کۆد و ناوی حساب پێویستن");
      if (!Number.isFinite(account.openingBalanceIQD)) throw new Error("باڵانسی سەرەتایی دروست بنووسە");
      if (data.accounts.some((item) => item.id !== account.id && item.code.toLowerCase() === code.toLowerCase())) throw new Error("ئەم کۆدە پێشتر بەکارهاتووە");
      return saveRecordWithAudit("accounts", account, current ? "account.updated" : "account.created", `${code} — ${name}`);
    }, current ? "حسابەکە نوێ کرایەوە" : "حسابەکە زیادکرا");
    if (saved) { setFormOpen(false); setEditing(null); }
  }

  const form = (current: LedgerAccount | null) => <form className="record-form" onSubmit={(event) => void submit(event, current)}><Field label="کۆدی حساب"><input name="code" required autoFocus dir="ltr" defaultValue={current?.code} placeholder="1010" /></Field><Field label="ناوی حساب"><input name="name" required defaultValue={current?.name} placeholder="قاسەی سەرەکی" /></Field><Field label="جۆری حساب"><select name="type" defaultValue={current?.type ?? "asset"}><option value="asset">سامان</option><option value="liability">قەرز/پابەندی</option><option value="equity">سەرمایە</option><option value="income">داهات</option><option value="expense">خەرجی</option></select></Field><Field label="باڵانسی سەرەتایی"><input name="openingBalance" type="number" step="1" defaultValue={current?.openingBalanceIQD ?? 0} /></Field><Field label="تێبینی" wide><textarea name="note" rows={3} defaultValue={current?.note} /></Field>{current && <label className="toggle-field field-wide"><input name="active" type="checkbox" defaultChecked={current.active} /><span><LockKeyhole size={18} /><b>حسابەکە چالاک بێت</b><small>حسابە ناچالاکەکان لە هەڵبژاردنە داراییە نوێیەکاندا پیشان نادرێن.</small></span></label>}<div className="form-actions"><button className="secondary-action" type="button" onClick={() => { setFormOpen(false); setEditing(null); }}>پاشگەزبوونەوە</button><SubmitButton>{current ? "نوێکردنەوە" : "تۆمارکردن"}</SubmitButton></div></form>;

  return <><Toolbar title="حسابەکان" description="دلیل الحساب؛ سامان، پابەندی، سەرمایە، داهات و خەرجی" search={search} setSearch={setSearch} action={<button className="toolbar-primary" type="button" onClick={() => setFormOpen(true)}><Plus size={17} />حسابی نوێ</button>} /><div className="accounting-grid"><Metric label="هەموو حسابەکان" value={numberFormatter.format(data.accounts.length)} /><Metric label="حسابی چالاک" value={numberFormatter.format(activeCount)} /><Metric label="باڵانسی سەرەتایی" value={money(totalOpening)} alert={totalOpening < 0} /></div>{!rows.length ? <EmptyState icon={<FileText size={40} />} title={data.accounts.length ? "حساب نەدۆزرایەوە" : "هێشتا حساب نییە"} text={data.accounts.length ? "وشەی گەڕان بگۆڕە." : "یەکەم حساب بۆ قاسە، بانک، داهات یان خەرجی زیاد بکە."} /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>کۆد</th><th>ناوی حساب</th><th>جۆر</th><th>باڵانسی سەرەتایی</th><th>دۆخ</th><th>تێبینی</th><th>کردار</th></tr></thead><tbody>{rows.map((account) => <tr key={account.id}><td dir="ltr"><strong>{account.code}</strong></td><td>{account.name}</td><td><span className={`account-type ${account.type}`}>{accountTypeLabel(account.type)}</span></td><td className={account.openingBalanceIQD < 0 ? "debt-cell" : ""}>{money(account.openingBalanceIQD)}</td><td>{account.active ? <span className="status-pill success">چالاک</span> : <span className="status-pill returned">ناچالاک</span>}</td><td>{account.note || "—"}</td><td><button className="table-action" type="button" onClick={() => setEditing(account)}><Pencil size={14} />دەستکاری</button></td></tr>)}</tbody></table></div>}{formOpen && <Modal title="زیادکردنی حساب" onClose={() => setFormOpen(false)}>{form(null)}</Modal>}{editing && <Modal title={`دەستکاری ${editing.name}`} onClose={() => setEditing(null)}>{form(editing)}</Modal>}</>;
}

function Metric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) { return <div className={alert ? "metric-card alert" : "metric-card"}><span>{label}</span><strong>{value}</strong></div>; }

function returnedSaleProfit(record: ReturnRecord, sales: Sale[]) {
  const sale = sales.find((item) => item.id === record.sourceId);
  if (!sale) return 0;
  if (!record.items?.length) return sale.profitIQD;
  const grossProfit = record.items.reduce((sum, returned) => {
    const source = sale.items.find((item) => item.productId === returned.productId);
    return sum + (source ? (source.unitPriceIQD - source.costPriceIQD) * returned.quantity : 0);
  }, 0);
  return grossProfit - (record.discountImpactIQD ?? 0);
}

function entriesForShift(shift: CashShift, entries: CashEntry[]) {
  return entries.filter((entry) => recordPaymentMethod(entry) === "cash" && entry.createdAt >= shift.openedAt && (!shift.closedAt || entry.createdAt <= shift.closedAt)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function dualCashMoney(iqd: number, usd: number | null | undefined, showUsd: boolean) {
  return <span className="dual-money"><span>{money(iqd)}</span>{showUsd && <small>{usd === null || usd === undefined ? "—" : usdMoney(usd)}</small>}</span>;
}

function ShiftReportPaper({ shift, entries, settings, screenVisible = false }: { shift: CashShift; entries: CashEntry[]; settings: PosSettings | null; screenVisible?: boolean }) {
  const reportEntries = entriesForShift(shift, entries);
  const totals = shift.status === "open" ? calculateShiftCash(shift, entries) : shift;
  const hasUsd = Boolean(settings?.usdEnabled || shift.openingCashUSD || totals.cashInUSD || totals.cashOutUSD || reportEntries.some((entry) => cashEntryCurrency(entry) === "USD"));
  return <section className={`shift-report-sheet print-shift-report${screenVisible ? "" : " print-only-shift"}`} dir="rtl"><header className="shift-report-head"><div><p>{settings?.marketName || "ZHIROX SMART POS"}</p><h2>ڕاپۆرتی {shift.status === "open" ? "شەفتی کراوە" : "داخستنی شەفت"}</h2><small dir="ltr">SHIFT-{shift.id.slice(-8).toUpperCase()}</small></div><div><strong>{shift.operatorName}</strong><span>دەستپێک: {dateTime(shift.openedAt)}</span><span>کۆتایی: {shift.closedAt ? dateTime(shift.closedAt) : "هێشتا کراوەیە"}</span></div></header><div className="shift-report-summary"><Metric label="سەرەتا — IQD" value={money(shift.openingCashIQD)} /><Metric label="هاتووە ناو — IQD" value={money(totals.cashInIQD)} /><Metric label="چووەتە دەر — IQD" value={money(totals.cashOutIQD)} /><Metric label="چاوەڕوان — IQD" value={money(totals.expectedCashIQD)} /><Metric label="ژمێردراو — IQD" value={shift.countedCashIQD === null ? "—" : money(shift.countedCashIQD)} /><Metric label="جیاوازی — IQD" value={shift.differenceIQD === null ? "—" : money(shift.differenceIQD)} alert={Boolean(shift.differenceIQD)} />{hasUsd && <><Metric label="سەرەتا — USD" value={usdMoney(shift.openingCashUSD ?? 0)} /><Metric label="هاتووە ناو — USD" value={usdMoney(totals.cashInUSD ?? 0)} /><Metric label="چووەتە دەر — USD" value={usdMoney(totals.cashOutUSD ?? 0)} /><Metric label="چاوەڕوان — USD" value={usdMoney(totals.expectedCashUSD ?? 0)} /><Metric label="ژمێردراو — USD" value={shift.countedCashUSD === null || shift.countedCashUSD === undefined ? "—" : usdMoney(shift.countedCashUSD)} /><Metric label="جیاوازی — USD" value={shift.differenceUSD === null || shift.differenceUSD === undefined ? "—" : usdMoney(shift.differenceUSD)} alert={Boolean(shift.differenceUSD)} /></>}</div><div className="shift-report-section"><div className="subsection-title"><h4>جووڵەکانی پارە لەم شەفتەدا</h4><span>{numberFormatter.format(reportEntries.length)}</span></div>{!reportEntries.length ? <p className="shift-report-empty">هیچ جووڵەیەکی پارە لەم شەفتەدا تۆمار نەکراوە.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>وەسل</th><th>هۆکار</th><th>کەس</th><th>هاتووە ناو</th><th>چووەتە دەر</th><th>بنەمای IQD</th><th>تێبینی</th><th>کات</th></tr></thead><tbody>{reportEntries.map((entry) => <tr key={entry.id}><td dir="ltr">{cashReceiptNo(entry)}</td><td>{entry.reason}</td><td>{entry.partyName}</td><td className="stock-in">{entry.direction === "in" ? entrySettlementMoney(entry) : "—"}</td><td className="stock-out">{entry.direction === "out" ? entrySettlementMoney(entry) : "—"}</td><td>{money(entry.amountIQD)}</td><td>{entry.note || "—"}</td><td>{dateTime(entry.createdAt)}</td></tr>)}</tbody><tfoot><tr><td colSpan={3}>کۆی جووڵەکان</td><td>{dualCashMoney(totals.cashInIQD, totals.cashInUSD, hasUsd)}</td><td>{dualCashMoney(totals.cashOutIQD, totals.cashOutUSD, hasUsd)}</td><td colSpan={3} /></tr></tfoot></table></div>}</div>{shift.note && <div className="shift-report-note"><strong>تێبینی داخستن</strong><p>{shift.note}</p></div>}<footer className="shift-report-footer"><span>دەرکراوە لە: {new Date().toLocaleString("ckb-IQ")}</span><span>واژۆی کاشێر: ____________________</span><span>واژۆی بەڕێوەبەر: ____________________</span></footer></section>;
}

function ShiftReportDetail({ shift, entries, settings }: { shift: CashShift; entries: CashEntry[]; settings: PosSettings | null }) {
  return <div className="shift-report-detail"><div className="shift-report-actions"><button className="toolbar-primary" type="button" onClick={printShiftDocument}><Printer size={16} />چاپی ڕاپۆرتی شەفت</button></div><ShiftReportPaper shift={shift} entries={entries} settings={settings} screenVisible /></div>;
}

function journalSourceLabel(source: JournalEntry["sourceType"]) {
  const labels: Record<JournalEntry["sourceType"], string> = {
    opening: "باڵانسی گواستراوە",
    recordOpening: "باڵانسی سەرەتایی",
    productImport: "هێنانی کالا",
    sale: "فرۆشتن",
    saleReturn: "گەڕاوی فرۆش",
    purchase: "کڕین",
    purchaseReturn: "گەڕاوی کڕین",
    expense: "خەرجی",
    cash: "جووڵەی پارە",
    loss: "خەساربوو",
    stockAdjustment: "ڕێکخستنی کۆگا",
    stocktake: "ژماردنی کۆگا",
  };
  return labels[source];
}

function JournalEntryDetail({ entry }: { entry: JournalEntry }) {
  return <div className="journal-detail"><div className="journal-detail-head"><div><span>سەرچاوە</span><strong>{journalSourceLabel(entry.sourceType)}</strong></div><div><span>ژمارەی بەڵگە</span><strong dir="ltr">{entry.reference}</strong></div><div><span>بەکارهێنەر</span><strong>{entry.operatorName}</strong></div><div><span>کات</span><strong>{dateTime(entry.createdAt)}</strong></div></div><p className="journal-memo">{entry.memo}</p><div className="data-table-wrap"><table className="data-table"><thead><tr><th>کۆد</th><th>ناوی حساب</th><th>Debit / قەرزدار</th><th>Credit / قەرزپێدراو</th></tr></thead><tbody>{entry.lines.map((line, index) => <tr key={`${line.accountCode}-${index}`}><td dir="ltr"><strong>{line.accountCode}</strong></td><td>{line.accountName}</td><td className="stock-in">{line.debitIQD ? money(line.debitIQD) : "—"}</td><td className="stock-out">{line.creditIQD ? money(line.creditIQD) : "—"}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>کۆی هاوسەنگ</td><td>{money(entry.debitTotalIQD)}</td><td>{money(entry.creditTotalIQD)}</td></tr></tfoot></table></div></div>;
}

function AccountingPage({ data, onNavigate }: { data: DashboardData; onNavigate: (module: WorkspaceModuleKey) => void }) {
  const [selectedShift, setSelectedShift] = useState<CashShift | null>(null);
  const [selectedJournal, setSelectedJournal] = useState<JournalEntry | null>(null);
  const returnedSales = data.saleReturns.reduce((sum, item) => sum + item.totalIQD, 0);
  const returnedPurchases = data.purchaseReturns.reduce((sum, item) => sum + item.totalIQD, 0);
  const returnedProfit = data.saleReturns.reduce((sum, item) => sum + returnedSaleProfit(item, data.sales), 0);
  const saleTotal = data.sales.reduce((sum, item) => sum + item.totalIQD, 0) - returnedSales;
  const purchaseTotal = data.purchases.reduce((sum, item) => sum + item.totalIQD, 0) - returnedPurchases;
  const expense = data.expenses.reduce((sum, item) => sum + item.amountIQD, 0);
  const profit = data.sales.reduce((sum, item) => sum + item.profitIQD, 0) - returnedProfit - expense;
  const cashIn = data.cashEntries.filter((item) => recordPaymentMethod(item) === "cash" && item.direction === "in").reduce((sum, item) => sum + item.amountIQD, 0);
  const cashOut = data.cashEntries.filter((item) => recordPaymentMethod(item) === "cash" && item.direction === "out").reduce((sum, item) => sum + item.amountIQD, 0);
  const customerDebt = data.customers.reduce((sum, item) => sum + item.balanceIQD, 0);
  const supplierDebt = data.suppliers.reduce((sum, item) => sum + item.balanceIQD, 0);
  const trialMap = new Map<string, { code: string; name: string; debit: number; credit: number }>();
  for (const entry of data.journalEntries) {
    for (const line of entry.lines) {
      const row = trialMap.get(line.accountCode) ?? { code: line.accountCode, name: line.accountName, debit: 0, credit: 0 };
      row.name = line.accountName;
      row.debit += line.debitIQD;
      row.credit += line.creditIQD;
      trialMap.set(line.accountCode, row);
    }
  }
  const trialRows = [...trialMap.values()].sort((a, b) => a.code.localeCompare(b.code));
  const bankLedger = trialMap.get("1120");
  const bankBalance = (bankLedger?.debit ?? 0) - (bankLedger?.credit ?? 0);
  const journalDebit = data.journalEntries.reduce((sum, entry) => sum + entry.debitTotalIQD, 0);
  const journalCredit = data.journalEntries.reduce((sum, entry) => sum + entry.creditTotalIQD, 0);
  const journalBalanced = Math.abs(journalDebit - journalCredit) < 0.001;
  const recentJournals = [...data.journalEntries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  const shifts = [...data.cashShifts].sort((a, b) => b.openedAt.localeCompare(a.openedAt)).slice(0, 50);

  return <><Toolbar title="ژمێریاری" description="تۆماری دوولا، Trial Balance، پوختەی خۆکار و ڕاپۆرتی هەر شەفت" action={<button className="toolbar-primary" type="button" onClick={() => onNavigate("accounts")}><FileText size={16} />دلیلی حساب</button>} /><div className="accounting-grid"><Metric label="کۆی فرۆشتن" value={money(saleTotal)} /><Metric label="کۆی کڕین" value={money(purchaseTotal)} /><Metric label="قازانجی خاوێن" value={money(profit)} alert={profit < 0} /><Metric label="قاسەی فیزیکی" value={money(cashIn - cashOut)} alert={cashIn - cashOut < 0} /><Metric label="بانک/کارت" value={money(bankBalance)} alert={bankBalance < 0} /><Metric label="قەرزی لای کڕیار" value={money(customerDebt)} alert={customerDebt > 0} /><Metric label="قەرزی دابینکەر" value={money(supplierDebt)} alert={supplierDebt > 0} /></div><div className="accounting-note journal-note"><Check size={18} /><p>هەر مامەڵە بە Debit و Credit ـی هاوسەنگ تۆمار دەکرێت؛ کاش تەنها دەچێتە قاسەی فیزیکی، کارت و گواستنەوە دەچنە حسابی بانک، و داشکاندن بە حسابێکی جیا تۆمار دەبێت.</p></div><div className="subsection-title"><h4>تۆماری ژمێریاری یەکگرتوو</h4><span className={journalBalanced ? "journal-balanced" : "journal-unbalanced"}>{journalBalanced ? "هاوسەنگە" : "ناهاوسەنگە"}</span></div><div className="accounting-grid journal-metrics"><Metric label="ژمارەی Journal" value={numberFormatter.format(data.journalEntries.length)} /><Metric label="کۆی Debit" value={money(journalDebit)} /><Metric label="کۆی Credit" value={money(journalCredit)} alert={!journalBalanced} /></div>{trialRows.length > 0 && <><div className="subsection-title"><h4>Trial Balance — هاوسەنگی حسابەکان</h4><span>{numberFormatter.format(trialRows.length)} حساب</span></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>کۆد</th><th>ناوی حساب</th><th>کۆی Debit</th><th>کۆی Credit</th><th>باڵانس</th><th>لایەن</th></tr></thead><tbody>{trialRows.map((row) => { const balance = row.debit - row.credit; return <tr key={row.code}><td dir="ltr"><strong>{row.code}</strong></td><td>{row.name}</td><td>{money(row.debit)}</td><td>{money(row.credit)}</td><td><strong>{money(Math.abs(balance))}</strong></td><td>{Math.abs(balance) < 0.001 ? <span className="status-pill success">سفر</span> : balance > 0 ? <span className="status-pill debit">Debit</span> : <span className="status-pill credit">Credit</span>}</td></tr>; })}</tbody><tfoot><tr><td colSpan={2}>کۆی گشتی</td><td>{money(journalDebit)}</td><td>{money(journalCredit)}</td><td>{money(Math.abs(journalDebit - journalCredit))}</td><td>{journalBalanced ? "هاوسەنگ" : "پێویستی بە پشکنین"}</td></tr></tfoot></table></div></>}<div className="subsection-title"><h4>مێژووی تۆمارە نەگۆڕەکان</h4><span>{numberFormatter.format(data.journalEntries.length)}</span></div>{!recentJournals.length ? <EmptyState icon={<FileText size={40} />} title="هێشتا Journal نییە" text="لەگەڵ یەکەم مامەڵەی دارایی، تۆماری Debit/Credit لێرە دەردەکەوێت." /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>بەڵگە</th><th>جۆر</th><th>وردەکاری</th><th>بەکارهێنەر</th><th>Debit</th><th>Credit</th><th>کات</th><th>کردار</th></tr></thead><tbody>{recentJournals.map((entry) => <tr key={entry.id}><td dir="ltr"><strong>{entry.reference}</strong></td><td>{journalSourceLabel(entry.sourceType)}</td><td>{entry.memo}</td><td>{entry.operatorName}</td><td>{money(entry.debitTotalIQD)}</td><td>{money(entry.creditTotalIQD)}</td><td>{dateTime(entry.createdAt)}</td><td><button className="table-action" type="button" onClick={() => setSelectedJournal(entry)}><Eye size={14} />ڕیزەکان</button></td></tr>)}</tbody></table></div>}{data.journalEntries.length > recentJournals.length && <p className="result-limit">دوایین {numberFormatter.format(recentJournals.length)} تۆمار پیشان دەدرێت.</p>}{data.cashShifts.length > shifts.length && <p className="result-limit">دوایین {numberFormatter.format(shifts.length)} شەفت پیشان دەدرێت.</p>}{shifts.length > 0 && <><div className="subsection-title"><h4>مێژووی شەفت و داخستنی قاسە</h4><span>{numberFormatter.format(data.cashShifts.length)}</span></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>کاشێر</th><th>دەستپێک</th><th>کۆتایی</th><th>سەرەتا</th><th>هاتووە ناو</th><th>چووەتە دەر</th><th>چاوەڕوانکراو</th><th>ژمێردراو</th><th>جیاوازی</th><th>دۆخ</th><th>کردار</th></tr></thead><tbody>{shifts.map((shift) => { const totals = shift.status === "open" ? calculateShiftCash(shift, data.cashEntries) : shift; return <tr key={shift.id}><td><strong>{shift.operatorName}</strong></td><td>{dateTime(shift.openedAt)}</td><td>{shift.closedAt ? dateTime(shift.closedAt) : "—"}</td><td>{money(shift.openingCashIQD)}</td><td>{money(totals.cashInIQD)}</td><td>{money(totals.cashOutIQD)}</td><td>{money(totals.expectedCashIQD)}</td><td>{shift.countedCashIQD === null ? "—" : money(shift.countedCashIQD)}</td><td className={shift.differenceIQD && shift.differenceIQD !== 0 ? "debt-cell" : ""}>{shift.differenceIQD === null ? "—" : money(shift.differenceIQD)}</td><td>{shift.status === "open" ? <span className="status-pill warning">کراوەیە</span> : <span className="status-pill success">داخراوە</span>}</td><td><button className="table-action" type="button" onClick={() => setSelectedShift(shift)}><Eye size={14} />ڕاپۆرت</button></td></tr>; })}</tbody></table></div></>}{selectedJournal && <Modal wide title={`Journal — ${selectedJournal.reference}`} onClose={() => setSelectedJournal(null)}><JournalEntryDetail entry={selectedJournal} /></Modal>}{selectedShift && <Modal wide title={`ڕاپۆرتی شەفتی ${selectedShift.operatorName}`} onClose={() => setSelectedShift(null)}><ShiftReportDetail shift={selectedShift} entries={data.cashEntries} settings={data.settings} /></Modal>}</>;
}

function ReportsPage({ data }: { data: DashboardData }) {
  const today = localDateKey(new Date());
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 29);
  const [from, setFrom] = useState(localDateKey(monthAgo));
  const [to, setTo] = useState(today);
  const days = new Map<string, { sales: number; cashIn: number; cashOut: number; bankIn: number; bankOut: number; discounts: number; profit: number; purchases: number; expenses: number }>();
  const ensure = (iso: string) => { const key = iso.slice(0, 10); if (!days.has(key)) days.set(key, { sales: 0, cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, discounts: 0, profit: 0, purchases: 0, expenses: 0 }); return days.get(key)!; };
  data.sales.forEach((item) => {
    const row = ensure(item.createdAt);
    row.sales += item.totalIQD;
    row.profit += item.profitIQD;
    row.discounts += item.discountIQD ?? 0;
  });
  data.saleReturns.forEach((item) => {
    const row = ensure(item.createdAt);
    row.sales -= item.totalIQD;
    row.profit -= returnedSaleProfit(item, data.sales);
    row.discounts -= item.discountImpactIQD ?? 0;
  });
  data.purchases.forEach((item) => { ensure(item.createdAt).purchases += item.totalIQD; });
  data.purchaseReturns.forEach((item) => { ensure(item.createdAt).purchases -= item.totalIQD; });
  data.expenses.forEach((item) => { ensure(item.createdAt).expenses += item.amountIQD; });
  data.journalEntries.forEach((entry) => {
    if (entry.sourceType === "opening" || entry.sourceType === "recordOpening") return;
    const row = ensure(entry.createdAt);
    entry.lines.forEach((line) => {
      if (line.accountCode === "1110") { row.cashIn += line.debitIQD; row.cashOut += line.creditIQD; }
      if (line.accountCode === "1120") { row.bankIn += line.debitIQD; row.bankOut += line.creditIQD; }
    });
  });
  const invalidRange = Boolean(from && to && from > to);
  const rows = [...days.entries()].filter(([day]) => (!from || day >= from) && (!to || day <= to)).sort(([a], [b]) => b.localeCompare(a));
  const totals = rows.reduce((summary, [, row]) => ({ sales: summary.sales + row.sales, cashIn: summary.cashIn + row.cashIn, cashOut: summary.cashOut + row.cashOut, bankIn: summary.bankIn + row.bankIn, bankOut: summary.bankOut + row.bankOut, discounts: summary.discounts + row.discounts, purchases: summary.purchases + row.purchases, profit: summary.profit + row.profit, expenses: summary.expenses + row.expenses }), { sales: 0, cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0, discounts: 0, purchases: 0, profit: 0, expenses: 0 });

  function exportReportCsv() {
    const header = ["ڕۆژ", "فرۆشتن", "کاشی هاتووە ناو", "کاشی چووەتە دەر", "بانکی هاتووە ناو", "بانکی چووەتە دەر", "داشکاندن", "کڕین", "قازانجی ناخاوێن", "خەرجی", "قازانجی خاوێن"];
    const lines: Array<Array<string | number>> = [header, ...rows.map(([day, row]) => [day, row.sales, row.cashIn, row.cashOut, row.bankIn, row.bankOut, row.discounts, row.purchases, row.profit, row.expenses, row.profit - row.expenses]), ["کۆی گشتی", totals.sales, totals.cashIn, totals.cashOut, totals.bankIn, totals.bankOut, totals.discounts, totals.purchases, totals.profit, totals.expenses, totals.profit - totals.expenses]];
    downloadTextFile(`zhirox-report-${from || "all"}-${to || "all"}.csv`, `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  return <>
    <Toolbar title="ڕاپۆرت" description="دیاریکردنی ماوە، پوختەی دارایی، چاپ و دەرکردنی CSV" action={<div className="inline-actions"><button className="secondary-action" type="button" disabled={!rows.length || invalidRange} onClick={exportReportCsv}><Download size={16} />CSV</button><button className="toolbar-primary" type="button" disabled={!rows.length || invalidRange} onClick={() => window.print()}><Printer size={16} />چاپی ڕاپۆرت</button></div>} />
    <div className="report-filters"><Field label="لە بەرواری"><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} dir="ltr" /></Field><Field label="تا بەرواری"><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} dir="ltr" /></Field><button className="secondary-action" type="button" onClick={() => { setFrom(""); setTo(""); }}>هەموو ماوەکان</button><span>{numberFormatter.format(rows.length)} ڕۆژ</span></div>
    {invalidRange && <p className="purchase-error">بەرواری دەستپێک نابێت دوای بەرواری کۆتایی بێت.</p>}
    <section className="report-sheet print-report"><header className="report-print-head"><div><p>{data.settings?.marketName || "ZHIROX SMART POS"}</p><h2>ڕاپۆرتی دارایی</h2></div><div><span>لە {from || "سەرەتا"}</span><span>تا {to || "ئەمڕۆ"}</span></div></header><div className="accounting-grid report-summary"><Metric label="فرۆشتنی خاوێن" value={money(totals.sales)} /><Metric label="جووڵەی خاوێنی کاش" value={money(totals.cashIn - totals.cashOut)} alert={totals.cashIn - totals.cashOut < 0} /><Metric label="جووڵەی خاوێنی بانک" value={money(totals.bankIn - totals.bankOut)} alert={totals.bankIn - totals.bankOut < 0} /><Metric label="داشکاندنی خاوێن" value={money(totals.discounts)} /><Metric label="کۆی کڕین" value={money(totals.purchases)} /><Metric label="قازانجی ناخاوێن" value={money(totals.profit)} /><Metric label="خەرجی" value={money(totals.expenses)} /><Metric label="قازانجی خاوێن" value={money(totals.profit - totals.expenses)} alert={totals.profit - totals.expenses < 0} /></div>{!rows.length || invalidRange ? <EmptyState icon={<FileText size={40} />} title="داتا بۆ ئەم ماوەیە نییە" text="ماوەیەکی تر هەڵبژێرە یان دوای تۆمارکردنی مامەڵەکان بگەڕێوە." /> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>ڕۆژ</th><th>فرۆشتن</th><th>کاشی ناو</th><th>کاشی دەر</th><th>بانکی ناو</th><th>بانکی دەر</th><th>داشکاندن</th><th>کڕین</th><th>قازانجی ناخاوێن</th><th>خەرجی</th><th>قازانجی خاوێن</th></tr></thead><tbody>{rows.map(([day, row]) => <tr key={day}><td dir="ltr">{day}</td><td>{money(row.sales)}</td><td>{money(row.cashIn)}</td><td>{money(row.cashOut)}</td><td>{money(row.bankIn)}</td><td>{money(row.bankOut)}</td><td>{money(row.discounts)}</td><td>{money(row.purchases)}</td><td>{money(row.profit)}</td><td>{money(row.expenses)}</td><td><strong>{money(row.profit - row.expenses)}</strong></td></tr>)}</tbody><tfoot><tr><td>کۆی گشتی</td><td>{money(totals.sales)}</td><td>{money(totals.cashIn)}</td><td>{money(totals.cashOut)}</td><td>{money(totals.bankIn)}</td><td>{money(totals.bankOut)}</td><td>{money(totals.discounts)}</td><td>{money(totals.purchases)}</td><td>{money(totals.profit)}</td><td>{money(totals.expenses)}</td><td>{money(totals.profit - totals.expenses)}</td></tr></tfoot></table></div>}<footer className="statement-footer"><span>دەرکراوە لە: {new Date().toLocaleString("ckb-IQ")}</span><span>ژمارەی ڕۆژەکان: {numberFormatter.format(rows.length)}</span></footer></section>
  </>;
}

type AuditCategory = "all" | "sales" | "stock" | "cash" | "records" | "security" | "backup";

function auditPresentation(action: string): { label: string; category: Exclude<AuditCategory, "all"> } {
  const labels: Record<string, { label: string; category: Exclude<AuditCategory, "all"> }> = {
    "sale.completed": { label: "تەواوکردنی فرۆشتن", category: "sales" },
    "sale.returned": { label: "گەڕاندنەوەی فرۆش", category: "sales" },
    "purchase.completed": { label: "تۆمارکردنی کڕین", category: "sales" },
    "purchase.returned": { label: "گەڕاندنەوەی کڕین", category: "sales" },
    "product.created": { label: "زیادکردنی کالا", category: "records" },
    "product.updated": { label: "نوێکردنەوەی کالا", category: "records" },
    "products.imported": { label: "هێنانی کالا بە CSV", category: "records" },
    "customer.created": { label: "زیادکردنی کڕیار", category: "records" },
    "customer.updated": { label: "نوێکردنەوەی کڕیار", category: "records" },
    "supplier.created": { label: "زیادکردنی دابینکەر", category: "records" },
    "supplier.updated": { label: "نوێکردنەوەی دابینکەر", category: "records" },
    "stock.loss": { label: "تۆمارکردنی خەسار", category: "stock" },
    "stock.adjusted.in": { label: "زیادکردنی دەستی کۆگا", category: "stock" },
    "stock.adjusted.out": { label: "کەمکردنی دەستی کۆگا", category: "stock" },
    "stocktake.completed": { label: "تەواوکردنی ژماردنی کۆگا", category: "stock" },
    "cash.in": { label: "پارەوەرگرتن", category: "cash" },
    "cash.out": { label: "پارەدان", category: "cash" },
    "expense.created": { label: "تۆمارکردنی خەرجی", category: "cash" },
    "cashShift.opened": { label: "کردنەوەی شەفت", category: "cash" },
    "cashShift.closed": { label: "داخستنی شەفت", category: "cash" },
    "account.created": { label: "زیادکردنی حساب", category: "records" },
    "account.updated": { label: "نوێکردنەوەی حساب", category: "records" },
    "user.created": { label: "زیادکردنی بەکارهێنەر", category: "security" },
    "user.updated": { label: "گۆڕینی بەکارهێنەر", category: "security" },
    "settings.updated": { label: "گۆڕینی ڕێکخستنەکان", category: "security" },
    "backup.exported": { label: "دەرکردنی پاشەکەوت", category: "backup" },
    "backup.restored": { label: "گەڕاندنەوەی پاشەکەوت", category: "backup" },
  };
  return labels[action] ?? { label: action, category: "records" };
}

function AuditPage({ data, search, setSearch }: { data: DashboardData; search: string; setSearch: (value: string) => void }) {
  const [category, setCategory] = useState<AuditCategory>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const today = localDateKey(new Date());
  const rows = [...data.audit]
    .filter((entry) => {
      const info = auditPresentation(entry.action);
      const day = entry.createdAt.slice(0, 10);
      const query = search.trim().toLowerCase();
      return (category === "all" || info.category === category)
        && (!from || day >= from) && (!to || day <= to)
        && (!query || `${info.label} ${entry.operatorName ?? ""} ${entry.entityId} ${entry.details ?? ""}`.toLowerCase().includes(query));
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visibleRows = rows.slice(0, 500);
  const todayCount = data.audit.filter((entry) => entry.createdAt.slice(0, 10) === today).length;
  const operatorCount = new Set(data.audit.map((entry) => entry.operatorId || entry.operatorName).filter(Boolean)).size;

  function exportAuditCsv() {
    const lines: Array<Array<string | number>> = [["بەروار", "کردار", "بەکارهێنەر", "وردەکاری", "ناسێنەر"]];
    rows.forEach((entry) => lines.push([entry.createdAt, auditPresentation(entry.action).label, entry.operatorName || "سیستەم", entry.details || "", entry.entityId]));
    downloadTextFile(`zhirox-audit-${from || "all"}-${to || "all"}.csv`, `\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  return <>
    <Toolbar title="تۆماری چاودێری" description="کردارە هەستیارەکان بە کات و ناوی بەکارهێنەر" search={search} setSearch={setSearch} action={<button className="secondary-action" type="button" disabled={!rows.length} onClick={exportAuditCsv}><Download size={16} />CSV</button>} />
    <div className="audit-summary"><Metric label="هەموو کردارەکان" value={numberFormatter.format(data.audit.length)} /><Metric label="کرداری ئەمڕۆ" value={numberFormatter.format(todayCount)} /><Metric label="بەکارهێنەری دیار" value={numberFormatter.format(operatorCount)} /></div>
    <div className="audit-filters"><Field label="جۆری کردار"><select value={category} onChange={(event) => setCategory(event.target.value as AuditCategory)}><option value="all">هەموو کردارەکان</option><option value="sales">فرۆش و کڕین</option><option value="stock">کۆگا</option><option value="cash">پارە و شەفت</option><option value="records">تۆمارەکان</option><option value="security">بەکارهێنەر و پاراستن</option><option value="backup">پاشەکەوت</option></select></Field><Field label="لە بەرواری"><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} dir="ltr" /></Field><Field label="تا بەرواری"><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} dir="ltr" /></Field><button className="secondary-action" type="button" onClick={() => { setCategory("all"); setFrom(""); setTo(""); setSearch(""); }}>پاککردنەوەی فلتەر</button></div>
    {!visibleRows.length ? <EmptyState icon={<Fingerprint size={40} />} title="هیچ کردارێک نەدۆزرایەوە" text="لەگەڵ تۆمارکردنی مامەڵە و گۆڕانکارییەکان، تۆماری چاودێری لێرە دەردەکەوێت." /> : <div className="data-table-wrap"><table className="data-table audit-table"><thead><tr><th>کردار</th><th>بەکارهێنەر</th><th>وردەکاری</th><th>ناسێنەر</th><th>کات</th></tr></thead><tbody>{visibleRows.map((entry) => { const info = auditPresentation(entry.action); return <tr key={entry.id}><td><span className={`audit-kind ${info.category}`}>{info.label}</span></td><td><strong>{entry.operatorName || "سیستەم"}</strong></td><td>{entry.details || "—"}</td><td dir="ltr"><small>{entry.entityId}</small></td><td>{dateTime(entry.createdAt)}</td></tr>; })}</tbody></table></div>}
    {rows.length > visibleRows.length && <p className="table-limit-note">تەنها ٥٠٠ تۆماری یەکەم پیشان دراون؛ بۆ دۆزینەوەی وردتر گەڕان یان فلتەر بەکاربهێنە.</p>}
  </>;
}

function UsersPage({ data, formOpen, setFormOpen, mutate }: { data: DashboardData; formOpen: boolean; setFormOpen: (v: boolean) => void; mutate: Mutate }) {
  const roles: Record<PosUser["role"], string> = { owner: "خاوەن", manager: "بەڕێوەبەر", cashier: "کاشێر", accountant: "ژمێریار" };
  const [editingUser, setEditingUser] = useState<PosUser | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>, existing: PosUser | null) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = existing?.id ?? createId("user");
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = String(form.get("role")) as PosUser["role"];
    const pin = String(form.get("pin") ?? "");
    const active = existing ? form.get("active") === "on" : true;
    const operator = currentOperator();
    const saved = await mutate(async () => {
      if (!name) throw new Error("ناوی بەکارهێنەر پێویستە");
      if (existing?.id === operator.id && !active) throw new Error("ناتوانیت هەژماری خۆت ناچالاک بکەیت");
      if (existing?.role === "owner" && (role !== "owner" || !active) && data.users.filter((user) => user.role === "owner" && user.active).length <= 1) throw new Error("لانیکەم یەک خاوەنی چالاک پێویستە");
      const pinHash = pin ? await createPinHash(id, pin) : existing?.pinHash ?? "";
      if (!pinHash) throw new Error("PIN ـی چوونەژوورەوە پێویستە");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ئیمەیڵەکە دروست نییە");
      if (email && data.users.some((user) => user.id !== id && user.email?.toLowerCase() === email)) throw new Error("ئەم ئیمەیڵە پێشتر بەکارهاتووە");
      const user: PosUser = { id, name, email: email || undefined, role, pinHash, active, createdAt: existing?.createdAt ?? new Date().toISOString() };
      await saveRecordWithAudit("users", user, existing ? "user.updated" : "user.created", user.name);
      if (operator.id === user.id && user.active) activatePosSession(user);
      return user;
    }, existing ? "زانیاری و دەسەڵاتی بەکارهێنەر نوێ کرایەوە" : "بەکارهێنەر زیادکرا");
    if (saved) {
      if (existing) setEditingUser(null);
      else setFormOpen(false);
    }
  }

  return <>
    <Toolbar title="بەکارهێنەرەکان" description="PIN، چالاکی و دەسەڵاتی خاوەن، بەڕێوەبەر، کاشێر و ژمێریار" action={<button className="toolbar-primary" type="button" onClick={() => setFormOpen(true)}><Plus size={17} />بەکارهێنەر</button>} />
    {!data.users.length ? <EmptyState icon={<UsersRound size={40} />} title="بەکارهێنەر نییە" text="یەکەم بەکارهێنەر و PIN ـەکەی زیاد بکە، پاشان دەتوانیت قفڵی ئامێر چالاک بکەیت." /> : <div className="user-cards">{data.users.map((user) => <article className={user.active ? "" : "inactive"} key={user.id}><span>{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><small>{roles[user.role]} · {user.pinHash ? "PIN دانراوە" : "PIN نییە"}{user.email ? ` · ${user.email}` : " · تەنها ناوخۆ"}</small></div><div className="user-card-actions"><i>{user.active ? "چالاک" : "ناچالاک"}</i><button className="table-action" type="button" onClick={() => setEditingUser(user)}><Pencil size={14} />دەستکاری</button></div></article>)}</div>}
    {formOpen && <Modal title="بەکارهێنەری نوێ" onClose={() => setFormOpen(false)}><UserForm user={null} onSubmit={(event) => void submit(event, null)} onCancel={() => setFormOpen(false)} /></Modal>}
    {editingUser && <Modal title={`دەستکاری ${editingUser.name}`} onClose={() => setEditingUser(null)}><UserForm user={editingUser} onSubmit={(event) => void submit(event, editingUser)} onCancel={() => setEditingUser(null)} /></Modal>}
  </>;
}

function UserForm({ user, onSubmit, onCancel }: { user: PosUser | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  return <form className="record-form" onSubmit={onSubmit}><Field label="ناو"><input name="name" required autoFocus defaultValue={user?.name} /></Field><Field label="ئیمەیڵی دەستگەیشتن"><input name="email" type="email" dir="ltr" defaultValue={user?.email} placeholder="cashier@market.com" /></Field><Field label="ڕۆڵ"><select name="role" defaultValue={user?.role ?? "cashier"}><option value="cashier">کاشێر</option><option value="manager">بەڕێوەبەر</option><option value="accountant">ژمێریار</option><option value="owner">خاوەن</option></select></Field><Field label={user ? "PIN ـی نوێ (ئارەزوومەندانە)" : "PIN ـی چوونەژوورەوە"}><input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required={!user} dir="ltr" placeholder={user ? "بەتاڵ بهێڵەوە بۆ پاراستنی PIN" : "٤ تا ٨ ژمارە"} /></Field>{user && <label className="toggle-field field-wide"><input name="active" type="checkbox" defaultChecked={user.active} /><span><LockKeyhole size={18} /><b>هەژمارەکە چالاک بێت</b><small>هەژماری ناچالاک ناتوانێت بە PIN بچێتە ژوورەوە.</small></span></label>}<p className="settings-hint field-wide">ئیمەیڵ دەسەڵاتی سێرڤەر دیاری دەکات؛ PIN بۆ قفڵی ناو ئامێرەکەیە.</p><div className="form-actions"><button className="secondary-action" type="button" onClick={onCancel}>پاشگەزبوونەوە</button><SubmitButton>{user ? "نوێکردنەوە" : "تۆمارکردن"}</SubmitButton></div></form>;
}

function LabelsPage({ data, onNavigate }: { data: DashboardData; onNavigate: Props["onNavigate"] }) {
  const [selected, setSelected] = useState<string[]>([]); const rows = data.products.filter((p) => selected.includes(p.id));
  if (!data.products.length) return <><Toolbar title="لەیبڵ" description="چاپی بارکۆد و نرخی کالا" /><EmptyState icon={<Printer size={40} />} title="کالا نییە" text="پێش چاپی لەیبڵ، کالا و بارکۆد زیاد بکە." action={<button className="toolbar-primary" type="button" onClick={() => onNavigate("products")}>کالا</button>} /></>;
  return <><Toolbar title="لەیبڵ و بارکۆد" description="کاڵاکان هەڵبژێرە و بارکۆدی ڕاستەقینەیان چاپ بکە" action={<button className="toolbar-primary" type="button" disabled={!selected.length} onClick={() => window.print()}><Printer size={17} />چاپ</button>} /><div className="label-selector">{data.products.map((product) => <label key={product.id}><input type="checkbox" checked={selected.includes(product.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, product.id] : old.filter((id) => id !== product.id))} /><span><strong>{product.name}</strong><small dir="ltr">{product.barcode}</small></span><b>{money(product.salePriceIQD)}</b></label>)}</div><div className="print-labels">{rows.map((product) => <div className="print-label" key={product.id}><strong>{product.name}</strong><span>{money(product.salePriceIQD)}</span><BarcodeGraphic value={product.barcode} /><small dir="ltr">{product.barcode}</small></div>)}</div></>;
}

function BackupPage({ data, mutate }: { data: DashboardData; mutate: Mutate }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ filename: string; text: string; inspection: BackupInspection } | null>(null);
  const [production, setProduction] = useState<ProductionStatus | null>(null);
  const [productionError, setProductionError] = useState("");
  const [productionLoading, setProductionLoading] = useState(true);
  const [restoreBusy, setRestoreBusy] = useState<number | null>(null);
  const currentTotal = data.customers.length + data.suppliers.length + data.products.length + data.sales.length + data.purchases.length + data.expenses.length + data.cashEntries.length + data.audit.length;

  useEffect(() => {
    let active = true;
    setProductionLoading(true);
    loadProductionStatus()
      .then((status) => { if (active) { setProduction(status); setProductionError(""); } })
      .catch((error) => { if (active) setProductionError(error instanceof Error ? error.message : "PRODUCTION_STATUS_FAILED"); })
      .finally(() => { if (active) setProductionLoading(false); });
    return () => { active = false; };
  }, [data.syncMeta.revision]);

  async function downloadBackup() {
    await mutate(async () => {
      const json = await exportDatabase();
      downloadTextFile(`zhirox-pos-backup-${new Date().toISOString().slice(0, 10)}.json`, json, "application/json");
    }, "فایلی پاشەکەوت بە واژۆی پاراستنەوە دروستکرا");
  }

  async function inspectFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("قەبارەی فایلەکە لە ٢٠MB زیاترە");
      const text = await file.text();
      const inspection = await inspectBackupJson(text);
      setPending({ filename: file.name, text, inspection });
    } catch (error) {
      await mutate(async () => { throw error; }, "");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    const restored = await mutate(() => restoreDatabaseFromJson(pending.text), "پاشەکەوت بە سەرکەوتوویی گەڕێندرایەوە");
    if (restored) window.setTimeout(() => window.location.reload(), 600);
  }

  async function restoreCloud(revision: number, day: string) {
    if (!window.confirm(`دڵنیایت دەتەوێت داتای کلاود بۆ پاشەکەوتی ${day} بگەڕێنیتەوە؟`)) return;
    setRestoreBusy(revision);
    const restored = await mutate(async () => {
      await restoreProductionRevision(revision);
      const pulled = await pullCloudOverLocal();
      if (pulled.phase !== "synced") throw new Error(pulled.message ?? "SYNC_PULL_FAILED");
    }, "پاشەکەوتی ڕۆژانە گەڕێندرایەوە و ئامێر نوێ کرایەوە");
    setRestoreBusy(null);
    if (restored) window.setTimeout(() => window.location.reload(), 500);
  }

  return <>
    <Toolbar title="پاشەکەوتی داتا" description="کۆپی تەواوی داتا بە پشکنینی ناوەڕۆک و واژۆی پاراستن" />
    <div className="backup-current"><div><span>تۆماری هەنووکەیی</span><strong>{numberFormatter.format(currentTotal)}</strong></div><div><span>کالا</span><strong>{numberFormatter.format(data.products.length)}</strong></div><div><span>مامەڵە</span><strong>{numberFormatter.format(data.sales.length + data.purchases.length)}</strong></div><div><span>تۆماری چاودێری</span><strong>{numberFormatter.format(data.audit.length)}</strong></div></div>
    <section className="production-panel">
      <div className="production-head"><Cloud size={21} /><div><strong>پاراستنی کلاود و چاودێری ئامێرەکان</strong><span>خاڵی گەڕاندنەوەی خۆکار بۆ ٣٠ ڕۆژی دواوە و دۆخی هەر کاشێر</span></div><b>{production ? `v${production.appVersion} · بازنە ${numberFormatter.format(production.currentRevision)}` : productionLoading ? "پشکنین..." : "بەردەست نییە"}</b></div>
      {productionError && <p className="production-error"><AlertTriangle size={16} />{productionError === "STAFF_ACCESS_DENIED" ? "ئەم ئیمەیڵە لە لیستی کارمەندانی سێرڤەر نییە" : "نەتوانرا دۆخی کلاود بخوێندرێتەوە"}</p>}
      {production && <div className="production-columns"><div><h3><MonitorCheck size={17} />ئامێرەکان</h3>{!production.devices.length ? <p className="production-empty">هێشتا ئامێرێک هاوکات نەکراوە.</p> : <div className="device-list">{production.devices.map((device) => { const fresh = Date.now() - new Date(device.lastSeenAt).getTime() < 10 * 60 * 1000; return <article key={device.deviceId}><i className={fresh ? "online" : "offline"} /><div><strong>{device.label}</strong><span>{device.actorName} · v{device.appVersion} · {dateTime(device.lastSeenAt)}</span></div><b>{device.pendingCount ? `${numberFormatter.format(device.pendingCount)} چاوەڕوان` : fresh ? "چالاک" : "دەرەوەی هێڵ"}</b></article>; })}</div>}</div><div><h3><ArchiveRestore size={17} />پاشەکەوتی ڕۆژانە</h3>{!production.restorePoints.length ? <p className="production-empty">لە یەکەم هاوکاتکردندا خۆکارانە دروست دەبێت.</p> : <div className="restore-point-list">{production.restorePoints.slice(0, 10).map((point) => <article key={point.day}><div><strong>{point.day}</strong><span>{numberFormatter.format(point.recordCount)} تۆمار · بازنە {numberFormatter.format(point.revision)}</span></div>{production.actor.role === "owner" && <button type="button" disabled={point.revision >= production.currentRevision || restoreBusy !== null} onClick={() => void restoreCloud(point.revision, point.day)}>{restoreBusy === point.revision ? "گەڕاندنەوە..." : point.revision >= production.currentRevision ? "ئێستا" : "گەڕاندنەوە"}</button>}</article>)}</div>}</div></div>}
    </section>
    <div className="backup-grid"><div className="backup-card"><Download size={36} /><div><h3>دەرکردنی پاشەکەوت</h3><p>کڕیار، کالا، مامەڵە، قەرز، شەفت، کۆگا، بەکارهێنەر و ڕێکخستنەکان لە فایلێکی پارێزراودا دادەگیرێن.</p></div><button className="toolbar-primary" type="button" onClick={() => void downloadBackup()}><Download size={17} />داگرتن</button></div><div className="backup-card restore"><Upload size={36} /><div><h3>گەڕاندنەوەی پاشەکەوت</h3><p>فایلەکە سەرەتا پشکنین دەکرێت و پوختەی تۆمارەکان پێش پەسەندکردن پیشان دەدرێت.</p></div><input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => void inspectFile(event.target.files?.[0])} /><button className="secondary-action" type="button" onClick={() => fileInput.current?.click()}><Upload size={17} />هەڵبژاردنی فایل</button></div></div>
    <div className="accounting-note"><AlertTriangle size={18} /><p>پێش گەڕاندنەوە پاشەکەوتێک لە داتای ئێستا دابگرە؛ کردارەکە هەموو تۆمارە هەنووکەییەکان دەگۆڕێت.</p></div>
    {pending && <Modal wide title="پشکنینی پاشەکەوت" onClose={() => setPending(null)}><div className="backup-preview"><div className="backup-file-head"><FileText size={30} /><div><strong dir="ltr">{pending.filename}</strong><span>{new Date(pending.inspection.exportedAt).toLocaleString("ckb-IQ")}</span></div><span className={`integrity-badge ${pending.inspection.integrity}`}>{pending.inspection.integrity === "verified" ? "واژۆ پەسەندکرا" : "فایلی کۆن"}</span></div><div className="backup-preview-grid"><Metric label="کۆی تۆمار" value={numberFormatter.format(pending.inspection.totalRecords)} /><Metric label="کالا" value={numberFormatter.format(pending.inspection.counts.products)} /><Metric label="کڕیار و دابینکەر" value={numberFormatter.format(pending.inspection.counts.customers + pending.inspection.counts.suppliers)} /><Metric label="فرۆش و کڕین" value={numberFormatter.format(pending.inspection.counts.sales + pending.inspection.counts.purchases)} /></div><p className="restore-warning"><AlertTriangle size={18} />پەسەندکردن، داتای هەنووکەیی دەسڕێتەوە و ئەم {numberFormatter.format(pending.inspection.totalRecords)} تۆمارە جێگیر دەکات.</p><div className="form-actions"><button className="secondary-action" type="button" onClick={() => setPending(null)}>پاشگەزبوونەوە</button><button className="danger-action" type="button" onClick={() => void confirmRestore()}><ArchiveRestore size={17} />گەڕاندنەوەی داتا</button></div></div></Modal>}
  </>;
}

function PrinterTestReceipt({ settings, width, showBarcode }: { settings: PosSettings | null; width: 58 | 80; showBarcode: boolean }) {
  return <section className={receiptClass({ receiptWidth: width })} dir="rtl"><header><h1>{settings?.marketName || "ZHIROX SMART POS"}</h1><p>چاپی تاقیکردنەوە</p>{settings?.address && <p>{settings.address}</p>}{settings?.phone && <p dir="ltr">{settings.phone}</p>}</header><div className="receipt-meta"><span>قەبارە: {width}mm</span><span>{new Date().toLocaleString("ckb-IQ")}</span></div><table><thead><tr><th>کالا</th><th>بڕ</th><th>نرخ</th><th>کۆ</th></tr></thead><tbody><tr><td>کالای تاقیکردنەوە</td><td>١</td><td>١٬٠٠٠</td><td>١٬٠٠٠</td></tr></tbody></table><div className="receipt-totals"><p><span>کۆی گشتی</span><strong>١٬٠٠٠ د.ع</strong></p></div>{showBarcode && <div className="receipt-code"><BarcodeGraphic value="ZHIROX-TEST" /><small dir="ltr">ZHIROX-TEST</small></div>}<footer>{settings?.receiptFooter || "سوپاس بۆ کڕینەکەتان"}</footer></section>;
}

function SettingsPage({ existing, users, syncMeta, mutate }: { existing: PosSettings | null; users: PosUser[]; syncMeta: SyncMeta; mutate: Mutate }) {
  const [receiptWidth, setReceiptWidth] = useState<58 | 80>(existing?.receiptWidth ?? 80);
  const [showReceiptBarcode, setShowReceiptBarcode] = useState(existing?.showReceiptBarcode ?? true);
  const [usdEnabled, setUsdEnabled] = useState(existing?.usdEnabled ?? false);
  const [usdToIqdRate, setUsdToIqdRate] = useState(String(configuredUsdRate(existing)));
  const [deviceLabel, setDeviceLabel] = useState(syncMeta.deviceLabel ?? "کاشێری سەرەکی");
  const [autoOpenCashDrawer, setAutoOpenCashDrawer] = useState(existing?.autoOpenCashDrawer ?? false);
  const [drawerNotice, setDrawerNotice] = useState("");

  async function testDrawer() {
    setDrawerNotice("پەیوەستکردن...");
    try {
      await connectCashDrawer();
      await pulseCashDrawer();
      setDrawerNotice("قاسە بە سەرکەوتوویی تاقیکرایەوە");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CASH_DRAWER_FAILED";
      setDrawerNotice(message === "CASH_DRAWER_UNSUPPORTED" ? "ئەم وێبگەڕە Web Serial پشتگیری ناکات" : "قاسە پەیوەست نەکرا؛ USB/Serial بپشکنە");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const deviceLockEnabled = form.get("deviceLockEnabled") === "on";
    const settings: PosSettings = {
      id: "main",
      marketName: String(form.get("marketName") || "Zhirox Smart POS").trim(),
      phone: String(form.get("phone") || "").trim(),
      address: String(form.get("address") || "").trim(),
      currency: "IQD",
      usdEnabled,
      usdToIqdRate: Number(usdToIqdRate),
      deviceLockEnabled,
      scalePrefix: String(form.get("scalePrefix") || "27").trim(),
      scaleItemDigits: Number(form.get("scaleItemDigits") || 7),
      scaleDecimals: Number(form.get("scaleDecimals") ?? 3),
      receiptWidth,
      showReceiptBarcode,
      autoPrintAfterSale: form.get("autoPrintAfterSale") === "on",
      autoOpenCashDrawer,
      receiptFooter: String(form.get("receiptFooter") || "").trim(),
      updatedAt: new Date().toISOString(),
    };
    await mutate(async () => {
      if (deviceLockEnabled && !users.some((user) => user.active && user.pinHash)) throw new Error("پێش چالاککردنی قفڵ، بەکارهێنەرێک بە PIN زیاد بکە");
      if (usdEnabled && (!Number.isFinite(settings.usdToIqdRate) || Number(settings.usdToIqdRate) <= 0)) throw new Error("نرخی گۆڕینەوەی USD بە دروستی بنووسە");
      await updateDeviceLabel(deviceLabel);
      return saveRecordWithAudit("settings", settings, "settings.updated", `${settings.receiptWidth}mm`);
    }, "ڕێکخستنەکان پاشەکەوت کران");
  }

  return <>
    <Toolbar title="ڕێکخستنەکان" description="ناسنامەی فرۆشگا، دراو، تەرازوو، چاپکەر و قفڵ" />
    <section className="production-device-card"><div className="settings-section-title"><MonitorCheck size={18} /><div><strong>ئامێر و قاسەی کاش</strong><span>ناوی ئەم کاشێرە بۆ چاودێری کلاود و پەیوەستکردنی قاسە</span></div></div><Field label="ناوی ئەم ئامێرە"><input value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="نموونە: کاشێری دەرگا" /></Field><label className="toggle-field"><input type="checkbox" checked={autoOpenCashDrawer} onChange={(event) => setAutoOpenCashDrawer(event.target.checked)} /><span><Usb size={18} /><b>دوای فرۆشتنی کاش قاسە بکەرەوە</b><small>ESC/POS لە ڕێگای USB/Serial؛ Chrome و Edge پشتگیری دەکەن.</small></span></label><div className="hardware-actions"><button className="secondary-action" type="button" disabled={!cashDrawerIsSupported()} onClick={() => void testDrawer()}><Usb size={16} />پەیوەستکردن و تاقیکردنەوە</button>{drawerNotice && <span>{drawerNotice}</span>}</div></section>
    <section className="currency-settings-card"><div className="settings-section-title"><FileText size={18} /><div><strong>دراو و نرخی گۆڕینەوە</strong><span>IQD بنەمای ژمێریارییە؛ USD وەک دراوی پارەدان چالاک بکە</span></div></div><label className="toggle-field"><input type="checkbox" checked={usdEnabled} onChange={(event) => setUsdEnabled(event.target.checked)} /><span><b>وەرگرتن و پارەدان بە USD</b><small>نرخی هەر مامەڵە لە پسوڵە و تۆماری قاسەدا جێگیر دەکرێت.</small></span></label><Field label="1 USD چەند IQD؟"><input value={usdToIqdRate} onChange={(event) => setUsdToIqdRate(event.target.value)} type="number" min="1" step="1" disabled={!usdEnabled} dir="ltr" /></Field><p className="settings-hint">ئەم نرخە نرخی خۆکار یان فەرمی نییە؛ خاوەن فرۆشگا دەبێت نرخی ڕاستەقینەی خۆی نوێ بکاتەوە.</p></section>
    <form key={existing?.updatedAt ?? "new"} className="settings-form" onSubmit={(event) => void submit(event)}><Field label="ناوی فرۆشگا"><input name="marketName" required defaultValue={existing?.marketName} placeholder="Zhirox Market" /></Field><Field label="مۆبایل"><input name="phone" defaultValue={existing?.phone} dir="ltr" /></Field><Field label="ناونیشان" wide><input name="address" defaultValue={existing?.address} /></Field><div className="settings-section-title field-wide"><Printer size={18} /><div><strong>چاپکەری پسوڵە</strong><span>قەبارە و شێوازی چاپ دیاری بکە</span></div></div><Field label="قەبارەی کاغەز"><select name="receiptWidth" value={receiptWidth} onChange={(event) => setReceiptWidth(Number(event.target.value) === 58 ? 58 : 80)}><option value="80">٨٠mm — چاپکەری گەورە</option><option value="58">٥٨mm — چاپکەری بچووک</option></select></Field><Field label="کۆتایی پسوڵە"><input name="receiptFooter" defaultValue={existing?.receiptFooter} placeholder="سوپاس بۆ کڕینەکەتان" /></Field><label className="toggle-field field-wide"><input name="showReceiptBarcode" type="checkbox" checked={showReceiptBarcode} onChange={(event) => setShowReceiptBarcode(event.target.checked)} /><span><ScanBarcode size={18} /><b>بارکۆدی پسوڵە پیشان بدە</b><small>ژمارەی پسوڵە بە بارکۆدی CODE128 لە خوارەوە چاپ دەکرێت.</small></span></label><label className="toggle-field field-wide"><input name="autoPrintAfterSale" type="checkbox" defaultChecked={existing?.autoPrintAfterSale ?? false} /><span><Printer size={18} /><b>دوای فرۆشتن خۆکارانە چاپ بکە</b><small>کاتێک فرۆشتن تەواو بوو پەنجەرەی چاپ خۆکارانە دەکرێتەوە.</small></span></label><div className="settings-section-title field-wide"><ScanBarcode size={18} /><div><strong>بارکۆدی تەرازوو</strong><span>شێوازی کۆدی کاڵای کێشراو</span></div></div><Field label="پێشگری بارکۆدی تەرازوو"><input name="scalePrefix" defaultValue={existing?.scalePrefix ?? "27"} dir="ltr" /></Field><Field label="درێژی کۆدی کالا"><input name="scaleItemDigits" type="number" defaultValue={existing?.scaleItemDigits ?? 7} min="3" max="11" /></Field><Field label="ژمارەی خانەی دەهەمی کێش"><input name="scaleDecimals" type="number" defaultValue={existing?.scaleDecimals ?? 3} min="0" max="4" /></Field><p className="settings-hint field-wide"><ScanBarcode size={17} /> نموونە: <b dir="ltr">2700002029709</b> → کۆد <b dir="ltr">2700002</b> و بڕی <b>٢.٩٧٠</b></p><label className="toggle-field field-wide"><input name="deviceLockEnabled" type="checkbox" defaultChecked={existing?.deviceLockEnabled ?? false} /><span><LockKeyhole size={18} /><b>قفڵی PIN چالاک بکە</b><small>تەنها بەکارهێنەرە تۆمارکراوەکان دەتوانن بچنە ژوورەوە.</small></span></label><div className="form-actions"><button className="secondary-action" type="button" onClick={() => window.print()}><Printer size={17} />چاپی تاقیکردنەوە</button><SubmitButton>پاشەکەوتکردن</SubmitButton></div></form>
    <PrinterTestReceipt settings={existing} width={receiptWidth} showBarcode={showReceiptBarcode} />
  </>;
}

function HelpPage() {
  const steps = ["لە بەشی کالا، بارکۆد و نرخی کڕین و فرۆشتن زیاد بکە؛ بۆ لیستی گەورە CSV بەکاربهێنە.", "کڕیار و دابینکەرە ڕاستەقینەکان تۆمار بکە؛ بۆ کڕیار سنووری قەرز دابنێ یان سفر بنووسە بۆ بێ سنوور.", "کڕینەکان بۆ زیادکردنی کۆگا بەکاربهێنە؛ کاش، کارت یان گواستنەوە هەڵبژێرە و پسوڵەکە چاپ بکە.", "لە ژمێریاری، دلیلی حساب بۆ قاسە، بانک، سەرمایە، داهات و خەرجی ڕێکبخە.", "پێش فرۆشتن شەفتی کاشێر بە پارەی سەرەتای قاسە بکەرەوە.", "لە کاشێر کاش، کارت یان گواستنەوە هەڵبژێرە و داشکاندن بە د.ع یان ڕێژە دیاری بکە؛ باقی تەنها بۆ کاشە.", "پارەی کارت و گواستنەوە ناچێتە قاسەی فیزیکی؛ لە حسابی بانک/کارت و ڕاپۆرتدا جیاواز دەردەکەوێت.", "لە گەڕاوی فرۆش، پشکی داشکاندنی هەر کالا خۆکارانە کەم دەکرێتەوە و پارەکە لە هەمان ڕێگای سەرەتایی دەگەڕێتەوە.", "لە کۆگا، کەمبوو و تەواوبووەکان ببینە و بە سکانی بارکۆد ژماردنی ڕاستەقینە ئەنجام بدە.", "لە وەرگرتنی قەرز، پارەدان بە دابینکەر و خەرجی، ڕێگای پارەدان دیاری بکە؛ کشفی حساب و وەسل هەمان ڕێگا پیشان دەدەن.", "لە کۆتایی کار تەنها کاشی فیزیکی بژمێرە و شەفت دابخە؛ کارت و بانک لە باڵانسی خۆیاندا دەمێننەوە.", "لە ڕێکخستنەکان کاغەزی ٥٨mm یان ٨٠mm هەڵبژێرە و چاپی تاقیکردنەوە بکە.", "لە تۆماری چاودێری کردارە هەستیارەکان بگەڕێ و بە CSV دایبگرە.", "لە ڕاپۆرت ماوە دیاری بکە و بەردەوام پاشەکەوتێکی واژۆکراو دابگرە."];
  return <><Toolbar title="یارمەتی" description="دەستپێکردنی خێرا لە سیستەمەکە" /><div className="help-steps">{steps.map((step, index) => <article key={step}><span>{numberFormatter.format(index + 1)}</span><p>{step}</p></article>)}</div><div className="accounting-note"><AlertTriangle size={18} /><p>سیستەمەکە بە بنەمای ئۆفلاین کاردەکات؛ بۆ پاراستنی زیاتر بەردەوام پاشەکەوت دابگرە.</p></div></>;
}
