"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Building2, Check, ShieldCheck, UserCog } from "lucide-react";
import { MANAGER_PERMISSION_LABELS, MANAGER_PERMISSIONS, type PlatformMarket } from "@/lib/platform-contract";
import type { ManagerPermission } from "@/lib/production-contract";

type FormState = { name: string; managerName: string; managerEmail: string; permissions: ManagerPermission[] };
const initial: FormState = { name: "", managerName: "", managerEmail: "", permissions: [...MANAGER_PERMISSIONS] };

export default function PlatformPage() {
  const [markets, setMarkets] = useState<PlatformMarket[]>([]);
  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState<PlatformMarket | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeCount = useMemo(() => markets.filter((market) => market.status === "active").length, [markets]);
  const load = async () => {
    const response = await fetch("/api/platform/markets", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { markets?: PlatformMarket[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "PLATFORM_ACCESS_FAILED");
    setMarkets(payload.markets ?? []);
  };
  useEffect(() => { load().catch((reason) => setError(reason.message)).finally(() => setLoading(false)); }, []);

  const togglePermission = (permission: ManagerPermission, editingMode = false) => {
    if (editingMode && editing) setEditing({ ...editing, permissions: editing.permissions.includes(permission) ? editing.permissions.filter((item) => item !== permission) : [...editing.permissions, permission] });
    else setForm((current) => ({ ...current, permissions: current.permissions.includes(permission) ? current.permissions.filter((item) => item !== permission) : [...current.permissions, permission] }));
  };

  const createMarket = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/platform/markets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json().catch(() => ({})) as { market?: PlatformMarket; error?: string };
      if (!response.ok || !payload.market) throw new Error(payload.error ?? "MARKET_CREATE_FAILED");
      setMarkets((current) => [payload.market!, ...current]); setForm(initial);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "MARKET_CREATE_FAILED"); }
    finally { setBusy(false); }
  };

  const saveMarket = async () => {
    if (!editing) return; setBusy(true); setError("");
    try {
      const response = await fetch("/api/platform/markets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId: editing.marketId, status: editing.status, managerEmail: editing.managerEmail, managerName: editing.managerName, permissions: editing.permissions }) });
      const payload = await response.json().catch(() => ({})) as { market?: PlatformMarket; error?: string };
      if (!response.ok || !payload.market) throw new Error(payload.error ?? "MARKET_UPDATE_FAILED");
      setMarkets((current) => current.map((item) => item.marketId === payload.market!.marketId ? payload.market! : item)); setEditing(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "MARKET_UPDATE_FAILED"); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="platform-shell"><p className="platform-loading">پانێڵەکە ئامادە دەکرێت...</p></main>;
  if (error === "AUTH_REQUIRED" || error === "PLATFORM_OWNER_REQUIRED") return <main className="platform-shell"><section className="platform-denied"><ShieldCheck size={44} /><h1>دەستگەیشتن ڕێگەپێنەدراوە</h1><p>ئەم بەشە تەنها بۆ خاوەنی سیستەمە و هیچ داتای دارایی مارکێتەکان پیشان نادات.</p><a href="/"><ArrowRight size={17} /> گەڕانەوە</a></section></main>;

  return <main className="platform-shell">
    <header className="platform-head"><div><span><ShieldCheck size={18} /> PLATFORM OWNER</span><h1>بەڕێوەبردنی مارکێتەکان</h1><p>درووستکردنی مارکێت، دانانی بەڕێوەبەر و دیاریکردنی دەسەڵات — بەبێ دەستگەیشتن بە داتای بازرگانی.</p></div><a href="/"><ArrowRight size={17} /> سیستەمی POS</a></header>
    <section className="platform-metrics"><div><Building2 /><span>هەموو مارکێتەکان</span><strong>{markets.length}</strong></div><div><Check /><span>مارکێتی چالاک</span><strong>{activeCount}</strong></div><div><UserCog /><span>بەڕێوەبەری دانراو</span><strong>{markets.filter((item) => item.managerEmail).length}</strong></div></section>
    {error && <p className="platform-error">{error}</p>}
    <section className="platform-grid">
      <form className="platform-card platform-create" onSubmit={createMarket}><h2>مارکێتی نوێ</h2><label>ناوی مارکێت<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label><label>ناوی بەڕێوەبەر<input value={form.managerName} onChange={(event) => setForm({ ...form, managerName: event.target.value })} required /></label><label>ئیمەیڵی بەڕێوەبەر<input dir="ltr" type="email" value={form.managerEmail} onChange={(event) => setForm({ ...form, managerEmail: event.target.value })} required /></label><fieldset><legend>دەسەڵاتەکانی بەڕێوەبەر</legend>{MANAGER_PERMISSIONS.map((permission) => <label className="permission-check" key={permission}><input type="checkbox" checked={form.permissions.includes(permission)} onChange={() => togglePermission(permission)} /><span>{MANAGER_PERMISSION_LABELS[permission]}</span></label>)}</fieldset><button disabled={busy}>{busy ? "تۆمارکردن..." : "درووستکردنی مارکێت"}</button></form>
      <section className="platform-card market-list"><div className="platform-card-title"><h2>مارکێتە تۆمارکراوەکان</h2><span>{markets.length}</span></div>{!markets.length ? <p className="empty-platform">هێشتا هیچ مارکێتێک درووست نەکراوە.</p> : markets.map((market) => <article className="platform-market" key={market.marketId}><div><span className={`market-status ${market.status}`}>{market.status === "active" ? "چالاک" : market.status === "trial" ? "تاقیکردنەوە" : "ڕاگیراو"}</span><h3>{market.marketName}</h3><p>{market.managerName ?? "بەڕێوەبەر دانەنراوە"}</p><small dir="ltr">{market.managerEmail}</small></div><div className="market-permission-summary">{market.permissions.map((permission) => <span key={permission}>{MANAGER_PERMISSION_LABELS[permission]}</span>)}</div><button type="button" onClick={() => setEditing({ ...market })}>دەستکاری</button></article>)}</section>
    </section>
    {editing && <div className="platform-modal"><section><h2>دەستکاری {editing.marketName}</h2><label>دۆخی مارکێت<select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as PlatformMarket["status"] })}><option value="trial">تاقیکردنەوە</option><option value="active">چالاک</option><option value="suspended">ڕاگیراو</option></select></label><label>ناوی بەڕێوەبەر<input value={editing.managerName ?? ""} onChange={(event) => setEditing({ ...editing, managerName: event.target.value })} /></label><label>ئیمەیڵی بەڕێوەبەر<input dir="ltr" type="email" value={editing.managerEmail ?? ""} onChange={(event) => setEditing({ ...editing, managerEmail: event.target.value })} /></label><fieldset><legend>دەسەڵاتەکان</legend>{MANAGER_PERMISSIONS.map((permission) => <label className="permission-check" key={permission}><input type="checkbox" checked={editing.permissions.includes(permission)} onChange={() => togglePermission(permission, true)} /><span>{MANAGER_PERMISSION_LABELS[permission]}</span></label>)}</fieldset><div className="platform-modal-actions"><button type="button" className="secondary" onClick={() => setEditing(null)}>پاشگەزبوونەوە</button><button type="button" onClick={() => void saveMarket()} disabled={busy}>پاشەکەوتکردن</button></div></section></div>}
  </main>;
}
