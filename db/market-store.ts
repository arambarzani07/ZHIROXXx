import { env } from "cloudflare:workers";
import { actorIdForEmail } from "@/db/sync-store";
import type { MarketContext, MarketMembership } from "@/lib/market-contract";

let marketSchemaPromise: Promise<void> | null = null;

function database() {
  if (!env.DB) throw new Error("MARKET_DATABASE_UNAVAILABLE");
  return env.DB;
}

export async function ensureMarketSchema() {
  if (marketSchemaPromise) return marketSchemaPromise;
  const db = database();
  marketSchemaPromise = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_markets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'suspended')),
      owner_actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_market_memberships (
      market_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'accountant')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (market_id, actor_id),
      UNIQUE (market_id, email),
      FOREIGN KEY (market_id) REFERENCES pos_markets(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_markets_owner_idx ON pos_markets (owner_actor_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_market_memberships_actor_idx ON pos_market_memberships (actor_id, active)"),
  ]).then(() => undefined).catch((error) => { marketSchemaPromise = null; throw error; });
  return marketSchemaPromise;
}

function slugify(value: string) {
  const base = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36);
  return base || "market";
}

export async function listActorMarkets(input: { email: string; displayName: string }): Promise<MarketMembership[]> {
  await ensureMarketSchema();
  const actorId = await actorIdForEmail(input.email);
  const platformOwner = await database().prepare("SELECT 1 AS found FROM pos_platform_owners WHERE actor_id = ? AND active = 1")
    .bind(actorId).first<{ found: number }>().catch(() => null);
  if (platformOwner) return [];
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim().slice(0, 120) || email;
  const now = new Date().toISOString();
  const legacy = await database().prepare(`SELECT role, active FROM pos_staff
    WHERE tenant_id = 'main-market' AND actor_id = ?`).bind(actorId).first<{ role: MarketMembership["role"]; active: number }>().catch(() => null);
  if (legacy?.active === 1) {
    await database().batch([
      database().prepare(`INSERT OR IGNORE INTO pos_markets
        (id, name, slug, status, owner_actor_id, created_at, updated_at)
        VALUES ('main-market', 'Zhirox Smart POS', 'main-market', 'active', ?, ?, ?)`).bind(actorId, now, now),
      database().prepare(`INSERT OR IGNORE INTO pos_market_memberships
        (market_id, actor_id, email, display_name, role, active, created_at, updated_at)
        VALUES ('main-market', ?, ?, ?, ?, 1, ?, ?)`).bind(actorId, email, displayName, legacy.role, now, now),
    ]);
  }
  const rows = await database().prepare(`SELECT m.id AS marketId, m.name AS marketName, m.slug AS marketSlug,
      m.status, mm.role, mm.active
    FROM pos_market_memberships mm INNER JOIN pos_markets m ON m.id = mm.market_id
    WHERE mm.actor_id = ? AND mm.active = 1 ORDER BY m.created_at`)
    .bind(actorId).all<MarketMembership & { active: number }>();
  return rows.results.map((row) => ({ ...row, active: row.active === 1 }));
}

export async function createMarket(input: { email: string; displayName: string; name: string }) {
  await ensureMarketSchema();
  const name = input.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("MARKET_NAME_INVALID");
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim().slice(0, 120) || email;
  const actorId = await actorIdForEmail(email);
  const marketId = `market_${crypto.randomUUID()}`;
  const slug = `${slugify(name)}-${marketId.slice(-8)}`;
  const now = new Date().toISOString();
  const db = database();
  await db.batch([
    db.prepare(`INSERT INTO pos_markets (id, name, slug, status, owner_actor_id, created_at, updated_at)
      VALUES (?, ?, ?, 'trial', ?, ?, ?)`).bind(marketId, name, slug, actorId, now, now),
    db.prepare(`INSERT INTO pos_market_memberships
      (market_id, actor_id, email, display_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'owner', 1, ?, ?)`).bind(marketId, actorId, email, displayName, now, now),
  ]);
  return { marketId, marketName: name, marketSlug: slug, status: "trial" as const, role: "owner" as const, active: true };
}

export async function resolveMarketContext(input: { email: string; displayName: string; marketId: string }): Promise<MarketContext | null> {
  await ensureMarketSchema();
  const actorId = await actorIdForEmail(input.email);
  const row = await database().prepare(`SELECT m.id AS marketId, m.name AS marketName, m.slug AS marketSlug,
      m.status, mm.role, mm.active
    FROM pos_market_memberships mm INNER JOIN pos_markets m ON m.id = mm.market_id
    WHERE mm.market_id = ? AND mm.actor_id = ? AND mm.active = 1`)
    .bind(input.marketId, actorId).first<MarketMembership & { active: number }>();
  if (!row || row.status === "suspended") return null;
  return { ...row, active: true, actorId, email: input.email.trim().toLowerCase(), displayName: input.displayName.trim() || input.email };
}
