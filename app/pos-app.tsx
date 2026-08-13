"use client";

import {
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  BadgeDollarSign,
  Barcode,
  Boxes,
  ChartNoAxesCombined,
  CircleHelp,
  Cloud,
  CloudUpload,
  Database,
  HandCoins,
  Landmark,
  LockKeyhole,
  LogOut,
  PackageOpen,
  ReceiptText,
  RefreshCcw,
  RotateCcw,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  TriangleAlert,
  UserRoundCog,
  UsersRound,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  activatePosSession,
  clearPosSession,
  countStores,
  getPosSessionSnapshot,
  getRecord,
  ensureJournalOpeningSnapshot,
  listRecords,
  openPosDatabase,
  parsePosSession,
  subscribePosSession,
  verifyPosPin,
  type PosSettings,
  type PosUser,
  type StoreCounts,
} from "@/lib/pos-db";
import { pullCloudOverLocal, switchCloudMarket, syncPosData, type PosSyncResult } from "@/lib/pos-sync";
import { getSelectedMarketId, loadMarkets, setSelectedMarketId } from "@/lib/market-client";
import type { MarketMembership } from "@/lib/market-contract";
import ModuleWorkspace, { type WorkspaceModuleKey } from "./module-workspace";

type Tone = "amber" | "violet" | "red" | "charcoal" | "slate";

type ModuleKey = WorkspaceModuleKey;

type ModuleDefinition = {
  key: ModuleKey;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: Tone;
  countStore?: keyof StoreCounts;
  hidden?: boolean;
};

const modules: ModuleDefinition[] = [
  { key: "customers", title: "کڕیار", description: "کڕیار، قەرز و کشفی حساب", icon: UsersRound, tone: "amber", countStore: "customers" },
  { key: "salesReturns", title: "گەڕاوی فرۆش", description: "گەڕاندنەوەی پسوڵە و کالا", icon: RotateCcw, tone: "amber" },
  { key: "sales", title: "فرۆشراو", description: "مێژووی هەموو فرۆشتنەکان", icon: ReceiptText, tone: "amber", countStore: "sales" },
  { key: "cashier", title: "کاشێر", description: "فرۆشتن و دەرکردنی پسوڵە", icon: ShoppingCart, tone: "amber" },
  { key: "products", title: "کالا", description: "بارکۆد، نرخ و یەکە", icon: Boxes, tone: "violet", countStore: "products" },
  { key: "suppliers", title: "دابینکەر", description: "کۆمپانیا و کشفی حساب", icon: Truck, tone: "violet", countStore: "suppliers" },
  { key: "purchaseReturns", title: "گەڕاوی کڕین", description: "گەڕاندنەوە بۆ دابینکەر", icon: RefreshCcw, tone: "violet" },
  { key: "purchases", title: "کڕین", description: "تۆمارکردنی پسوڵەی کڕین", icon: ShoppingBag, tone: "violet", countStore: "purchases" },
  { key: "accounting", title: "ژمێریاری", description: "قاسە، قەرز و جووڵەی پارە", icon: BadgeDollarSign, tone: "charcoal" },
  { key: "accounts", title: "حسابەکان", description: "دلیل الحساب و باڵانسەکان", icon: Landmark, tone: "slate", countStore: "accounts", hidden: true },
  { key: "losses", title: "خەساربوو", description: "تێکچوو، بەسەرچوو و کەمبوو", icon: ArrowLeftRight, tone: "red", countStore: "losses" },
  { key: "labels", title: "لەیبڵ", description: "چاپی بارکۆد و نرخ", icon: Barcode, tone: "red" },
  { key: "warehouse", title: "کۆگا", description: "بڕ و بەهای کاڵاکان", icon: PackageOpen, tone: "red", countStore: "products" },
  { key: "cashIn", title: "پارەوەرگرتن", description: "وەرگرتنی پارە و قەرز", icon: ArrowDownToLine, tone: "slate", countStore: "cashEntries" },
  { key: "cashOut", title: "پارەدان", description: "پارەدان بە دابینکەر و کەسان", icon: ArrowUpFromLine, tone: "slate", countStore: "cashEntries" },
  { key: "expenses", title: "خەرجی", description: "کرێ، کارەبا و خەرجییەکان", icon: HandCoins, tone: "slate", countStore: "expenses" },
  { key: "reports", title: "ڕاپۆرت", description: "فرۆش، قازانج و کۆگا", icon: ChartNoAxesCombined, tone: "slate" },
  { key: "help", title: "یارمەتی", description: "ڕێنمایی بەکارهێنانی سیستەم", icon: CircleHelp, tone: "slate" },
  { key: "settings", title: "ڕێکخستنەکان", description: "فرۆشگا، دراو و چاپکەر", icon: Settings, tone: "slate" },
  { key: "backup", title: "پاشەکەوتی داتا", description: "پاراستن و گەڕاندنەوەی داتا", icon: CloudUpload, tone: "slate" },
  { key: "users", title: "بەکارهێنەر", description: "کاشێر و دەسەڵاتەکان", icon: UserRoundCog, tone: "slate", countStore: "users" },
];

const roleModules: Record<PosUser["role"], ModuleKey[] | "all"> = {
  owner: "all",
  manager: "all",
  cashier: ["cashier", "sales", "salesReturns", "customers", "cashIn", "help"],
  accountant: ["sales", "purchases", "purchaseReturns", "customers", "suppliers", "expenses", "accounting", "accounts", "cashIn", "cashOut", "reports", "backup", "help"],
};

const roleNames: Record<PosUser["role"], string> = {
  owner: "خاوەن",
  manager: "بەڕێوەبەر",
  cashier: "کاشێر",
  accountant: "ژمێریار",
};

const emptyCounts = {
  customers: 0,
  suppliers: 0,
  products: 0,
  sales: 0,
  purchases: 0,
  saleReturns: 0,
  purchaseReturns: 0,
  expenses: 0,
  cashEntries: 0,
  losses: 0,
  cashShifts: 0,
  stockAdjustments: 0,
  journalEntries: 0,
  accounts: 0,
  users: 0,
  audit: 0,
  outbox: 0,
  settings: 0,
} satisfies StoreCounts;

const initialSyncState: PosSyncResult = {
  phase: "pending",
  pending: 0,
  revision: 0,
  lastSyncedAt: null,
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ckb-IQ").format(value);
}

function subscribeToConnection(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getConnectionSnapshot() {
  return navigator.onLine;
}

export default function PosApp() {
  const online = useSyncExternalStore(subscribeToConnection, getConnectionSnapshot, () => true);
  const sessionSnapshot = useSyncExternalStore(subscribePosSession, getPosSessionSnapshot, () => "");
  const session = useMemo(() => parsePosSession(sessionSnapshot), [sessionSnapshot]);
  const [dbReady, setDbReady] = useState(false);
  const [counts, setCounts] = useState<StoreCounts>(emptyCounts);
  const [settings, setSettings] = useState<PosSettings | null>(null);
  const [activeModule, setActiveModule] = useState<ModuleDefinition | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [syncState, setSyncState] = useState<PosSyncResult>(initialSyncState);
  const [syncBusy, setSyncBusy] = useState(false);
  const [markets, setMarkets] = useState<MarketMembership[]>([]);
  const [marketId, setMarketId] = useState("");

  const refreshCounts = useCallback(async () => {
    const [nextCounts, nextSettings] = await Promise.all([
      countStores(),
      getRecord<PosSettings>("settings", "main"),
    ]);
    setCounts(nextCounts);
    setSettings(nextSettings ?? null);
    setLastUpdated(new Date());
  }, []);

  const performSync = useCallback(async () => {
    setSyncBusy(true);
    setSyncState((current) => ({ ...current, phase: "syncing" }));
    try {
      const next = await syncPosData();
      await ensureJournalOpeningSnapshot();
      setSyncState(next);
      await refreshCounts();
      return next;
    } finally {
      setSyncBusy(false);
    }
  }, [refreshCounts]);

  useEffect(() => {
    openPosDatabase()
      .then(() => ensureJournalOpeningSnapshot())
      .then(() => refreshCounts())
      .then(() => setDbReady(true))
      .catch(() => setDbReady(false));

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }

  }, [refreshCounts]);

  useEffect(() => {
    loadMarkets().then((available) => {
      setMarkets(available);
      if (!available.length) return;
      const stored = getSelectedMarketId();
      const selected = available.some((market) => market.marketId === stored) ? stored : available[0].marketId;
      setSelectedMarketId(selected);
      setMarketId(selected);
    }).catch(() => undefined);
  }, []);

  const changeMarket = useCallback(async (nextMarketId: string) => {
    if (!nextMarketId || nextMarketId === marketId) return;
    setSyncBusy(true);
    setActiveModule(null);
    try {
      await switchCloudMarket(nextMarketId);
      setMarketId(nextMarketId);
      clearPosSession();
      await refreshCounts();
      setSyncState({ phase: "synced", pending: 0, revision: 0, lastSyncedAt: new Date().toISOString(), pulled: true });
    } finally { setSyncBusy(false); }
  }, [marketId, refreshCounts]);

  useEffect(() => {
    if (!dbReady || !marketId) return;
    const synchronize = () => { if (navigator.onLine) void performSync(); };
    synchronize();
    window.addEventListener("online", synchronize);
    const interval = window.setInterval(synchronize, 60_000);
    return () => {
      window.removeEventListener("online", synchronize);
      window.clearInterval(interval);
    };
  }, [dbReady, marketId, performSync]);

  useEffect(() => {
    if (
      !dbReady || !online || counts.outbox === 0 || syncBusy ||
      syncState.phase === "conflict" || syncState.phase === "unauthorized" || syncState.phase === "error"
    ) return;
    const timeout = window.setTimeout(() => void performSync(), 700);
    return () => window.clearTimeout(timeout);
  }, [counts.outbox, dbReady, online, performSync, syncBusy, syncState.phase]);

  const handleDataChanged = useCallback(async () => {
    await refreshCounts();
    if (navigator.onLine) window.setTimeout(() => void performSync(), 250);
  }, [performSync, refreshCounts]);

  const acceptCloudCopy = useCallback(async () => {
    const confirmed = window.confirm("داتای کلەود جێگای گۆڕانکارییە هاوکات‌نەکراوەکانی ئەم ئامێرە دەگرێتەوە. پێشتر پاشەکەوتێک دابگرە. دڵنیایت؟");
    if (!confirmed) return;
    setSyncBusy(true);
    setSyncState((current) => ({ ...current, phase: "syncing" }));
    try {
      const next = await pullCloudOverLocal();
      await ensureJournalOpeningSnapshot();
      setSyncState(next);
      await refreshCounts();
    } finally {
      setSyncBusy(false);
    }
  }, [refreshCounts]);

  const syncLabel = useMemo(() => {
    if (!online || syncState.phase === "offline") return syncState.pending ? `${formatNumber(syncState.pending)} چاوەڕوان` : "ئۆفلاین";
    if (syncState.phase === "syncing") return "هاوکاتکردن...";
    if (syncState.phase === "conflict") return "پێکدانی داتا";
    if (syncState.phase === "unauthorized") return "تەنها ناوخۆ";
    if (syncState.phase === "error") return "هەڵەی Sync";
    if (syncState.phase === "pending" || syncState.pending) return `${formatNumber(syncState.pending)} چاوەڕوان`;
    return "هاوکاتە";
  }, [online, syncState]);

  const totalRecords = useMemo(
    () => counts.sales + counts.purchases + counts.products + counts.customers,
    [counts],
  );

  const lockEnabled = Boolean(settings?.deviceLockEnabled && counts.users > 0);
  const visibleModules = useMemo(() => {
    if (!lockEnabled || !session) return modules;
    const permitted = roleModules[session.role];
    return permitted === "all" ? modules : modules.filter((module) => permitted.includes(module.key));
  }, [lockEnabled, session]);

  const openModule = useCallback((key: ModuleKey) => {
    const selected = visibleModules.find((item) => item.key === key);
    if (selected) setActiveModule(selected);
  }, [visibleModules]);

  if (dbReady && lockEnabled && !session) {
    return <LoginGate marketName={settings?.marketName || "Zhirox Smart POS"} />;
  }

  return (
    <main className="pos-shell">
      <header className="topbar">
        <div className="brand-lockup video-brand">
          <span className="brand-mark" aria-hidden="true"><Store size={21} /></span>
          <div>
            <strong>ZHIROX</strong>
            <span>SMART POS</span>
          </div>
        </div>

        <div className="video-account-title"><strong>داشبۆردی حساب</strong><span>{settings?.marketName || "Zhirox Smart POS"}</span></div>

        <div className="market-switcher">
          <select aria-label="هەڵبژاردنی مارکێت" value={marketId} onChange={(event) => void changeMarket(event.target.value)} disabled={syncBusy}>
            {!markets.length && <option value="">مارکێت هەڵبژێرە</option>}
            {markets.map((market) => <option key={market.marketId} value={market.marketId}>{market.marketName}</option>)}
          </select>
          <a href="/platform" title="پانێڵی خاوەنی سیستەم">⚙</a>
        </div>

        <nav className="topbar-nav video-nav" aria-label="ڕێنوێنی سەرەکی">
          <button className="nav-item active" type="button">داشبۆرد</button>
          {visibleModules.some((item) => item.key === "reports") && <button className="nav-item" type="button" onClick={() => openModule("reports")}>پوختەی ئەمڕۆ</button>}
        </nav>

        {lockEnabled && session && <button className="operator-state" type="button" onClick={() => { setActiveModule(null); clearPosSession(); }} title="دەرچوون و قفڵکردن"><span><strong>{session.name}</strong><small>{roleNames[session.role]}</small></span><LogOut size={17} /></button>}

        <button
          className="connection-state"
          data-online={online}
          data-phase={syncState.phase}
          type="button"
          onClick={() => void performSync()}
          disabled={syncBusy || !dbReady}
          title="هاوکاتکردنی داتا"
        >
          {!online || syncState.phase === "offline" ? <WifiOff size={16} /> : syncState.phase === "conflict" || syncState.phase === "error" ? <TriangleAlert size={16} /> : syncState.phase === "synced" ? <Cloud size={16} /> : <Wifi size={16} />}
          <span>{syncLabel}</span>
        </button>
      </header>

      {syncState.phase === "conflict" && (
        <section className="sync-conflict-banner" role="alert">
          <TriangleAlert size={20} />
          <div>
            <strong>گۆڕانکاری لە دوو ئامێرەوە هەیە</strong>
            <span>بۆ پاراستنی حسابەکان هیچ داتایەک بە خۆکار تێکەڵ نەکرا. سەرەتا پاشەکەوت دابگرە، پاشان وەشانی کلەود وەربگرە.</span>
          </div>
          <button type="button" onClick={() => openModule("backup")}>پاشەکەوت</button>
          <button type="button" className="sync-pull-button" onClick={() => void acceptCloudCopy()} disabled={syncBusy}>داتای کلەود وەربگرە</button>
        </section>
      )}

      <section className="dashboard-wrap video-dashboard">
        <div className="video-dashboard-meta">
          <div className="local-engine" data-ready={dbReady}>
            <Database size={18} />
            <div><strong>{dbReady ? "داتای ناوخۆ ئامادەیە" : "ئامادەکردنی داتا..."}</strong><span>{online ? `ئۆفلاین-فرست؛ کلەود ${syncLabel}` : "سیستەمەکە بەبێ ئینتەرنێت کاردەکات"}</span></div>
          </div>
          <div className="video-totals"><span>کۆی تۆمار <b>{formatNumber(totalRecords)}</b></span><span>کالا <b>{formatNumber(counts.products)}</b></span><span>کڕیار <b>{formatNumber(counts.customers)}</b></span><span>فرۆش <b>{formatNumber(counts.sales)}</b></span></div>
        </div>

        <section className="module-grid" aria-label="بەشەکانی سیستەم">
          {visibleModules.filter((module) => !module.hidden).map((module) => {
            const Icon = module.icon;
            const count = module.countStore ? counts[module.countStore] : null;
            return (
              <button
                type="button"
                className={`module-card tone-${module.tone}`}
                key={module.key}
                onClick={() => setActiveModule(module)}
              >
                <span className="module-icon"><Icon size={28} strokeWidth={1.65} /></span>
                <span className="module-copy">
                  <strong>{module.title}</strong>
                  <small>{module.description}</small>
                </span>
                {count !== null && count > 0 && <span className="module-count">{formatNumber(count)}</span>}
              </button>
            );
          })}
        </section>

        <footer className="dashboard-footer video-footer">
          <span className="footer-status"><i data-ready={dbReady} /> {dbReady ? "بنکەدراوەی ناوخۆ چالاکە" : "بنکەدراوە ئامادە نییە"}</span>
          <span>{syncState.lastSyncedAt ? `دوایین Sync: ${new Date(syncState.lastSyncedAt).toLocaleTimeString("ckb-IQ", { hour: "2-digit", minute: "2-digit" })} — وەشان ${formatNumber(syncState.revision)}` : lastUpdated ? `دوایین نوێکردنەوە: ${lastUpdated.toLocaleTimeString("ckb-IQ", { hour: "2-digit", minute: "2-digit" })}` : "هیچ داتایەک هێشتا تۆمار نەکراوە"}</span>
        </footer>
      </section>

      {activeModule && (
        <div className="module-overlay" role="dialog" aria-modal="true" aria-label={activeModule.title}>
          <button className="overlay-scrim" type="button" aria-label="داخستن" onClick={() => setActiveModule(null)} />
          <section className="module-drawer">
            <header className={`drawer-head tone-${activeModule.tone}`}>
              <div className="drawer-title">
                <span><activeModule.icon size={26} /></span>
                <div><h2>{activeModule.title}</h2><p>{activeModule.description}</p></div>
              </div>
              <button type="button" className="close-button" onClick={() => setActiveModule(null)} aria-label="داخستن"><X size={22} /></button>
            </header>
            <div className="drawer-body">
              <ModuleWorkspace
                key={activeModule.key}
                moduleKey={activeModule.key}
                onDataChanged={handleDataChanged}
                onNavigate={openModule}
              />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function LoginGate({ marketName }: { marketName: string }) {
  const [users, setUsers] = useState<PosUser[]>([]);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    listRecords<PosUser>("users").then((records) => {
      if (!active) return;
      const available = records.filter((user) => user.active && user.pinHash);
      setUsers(available);
      setUserId(available[0]?.id ?? "");
    }).catch(() => { if (active) setError("نەتوانرا بەکارهێنەرەکان بخوێندرێنەوە"); });
    return () => { active = false; };
  }, []);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user = users.find((item) => item.id === userId);
    if (!user) { setError("بەکارهێنەر هەڵبژێرە"); return; }
    setBusy(true);
    setError("");
    try {
      if (!await verifyPosPin(user, pin)) { setError("PIN ـەکە هەڵەیە"); return; }
      activatePosSession(user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "چوونەژوورەوە تەواو نەبوو");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-screen"><section className="login-card"><div className="login-mark"><LockKeyhole size={27} /></div><p className="eyebrow">ZHIROX SMART POS</p><h1>{marketName}</h1><p className="login-copy">بەکارهێنەر هەڵبژێرە و PIN بنووسە</p><form onSubmit={(event) => void login(event)}><label><span>بەکارهێنەر</span><select value={userId} onChange={(event) => setUserId(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name} — {roleNames[user.role]}</option>)}</select></label><label><span>PIN</span><input autoFocus value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" minLength={4} maxLength={8} dir="ltr" /></label>{error && <p className="login-error">{error}</p>}<button type="submit" disabled={busy || !userId || pin.length < 4}>{busy ? "پشکنین..." : "چوونەژوورەوە"}</button></form><small>سیستەم بە ئۆفلاین کاردەکات؛ کاتێک ئینتەرنێت هەبێت داتا خۆکارانە لەگەڵ کلەود هاوکات دەبێت.</small></section></main>;
}
