import { env } from "cloudflare:workers";
import { actorIdForEmail, ensureSyncSchema } from "@/db/sync-store";
import { ensureMarketSchema } from "@/db/market-store";
import { MANAGER_PERMISSIONS, type PlatformMarket } from "@/lib/platform-contract";
import type { ManagerPermission } from "@/lib/production-contract";

const INITIAL_PLATFORM_OWNER_EMAIL = "arambarzani71@gmail.com";

function database() { if (!env.DB) throw new Error("PLATFORM_DATABASE_UNAVAILABLE"); return env.DB; }

export async function ensurePlatformSchema() {
  await Promise.all([ensureMarketSchema(), ensureSyncSchema()]);
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_platform_owners (
      actor_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS pos_platform_owner_block_second
      BEFORE INSERT ON pos_platform_owners WHEN EXISTS (SELECT 1 FROM pos_platform_owners)
      BEGIN SELECT RAISE(ABORT, 'PLATFORM_OWNER_SINGLETON_LOCKED'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS pos_platform_owner_block_identity_change
      BEFORE UPDATE OF actor_id, email ON pos_platform_owners
      BEGIN SELECT RAISE(ABORT, 'PLATFORM_OWNER_IDENTITY_LOCKED'); END`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS pos_platform_owner_block_delete
      BEFORE DELETE ON pos_platform_owners
      BEGIN SELECT RAISE(ABORT, 'PLATFORM_OWNER_PERMANENT'); END`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_manager_permissions (
      market_id TEXT NOT NULL, actor_id TEXT NOT NULL, permission TEXT NOT NULL,
      granted_by_actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (market_id, actor_id, permission)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_manager_permissions_actor_idx ON pos_manager_permissions (actor_id, market_id)"),
  ]);
  const ownerActorId = await actorIdForEmail(INITIAL_PLATFORM_OWNER_EMAIL);
  const now = new Date().toISOString();
  const existingOwner = await db.prepare("SELECT actor_id AS actorId FROM pos_platform_owners LIMIT 1").first<{ actorId: string }>();
  if (!existingOwner) {
    await db.prepare(`INSERT INTO pos_platform_owners
      (actor_id, email, display_name, active, created_at, updated_at) VALUES (?, ?, 'System Owner', 1, ?, ?)`)
      .bind(ownerActorId, INITIAL_PLATFORM_OWNER_EMAIL, now, now).run();
  } else if (existingOwner.actorId !== ownerActorId) {
    throw new Error("PLATFORM_OWNER_IDENTITY_MISMATCH");
  }
  await db.batch([
    db.prepare("DELETE FROM pos_market_memberships WHERE actor_id = ?").bind(ownerActorId),
    db.prepare("DELETE FROM pos_staff WHERE actor_id = ?").bind(ownerActorId),
  ]);
}

export async function requirePlatformOwner(input: { email: string; displayName: string }) {
  await ensurePlatformSchema();
  const email = input.email.trim().toLowerCase();
  const actorId = await actorIdForEmail(email);
  const row = await database().prepare("SELECT active FROM pos_platform_owners WHERE actor_id = ? AND email = ?")
    .bind(actorId, email).first<{ active: number }>();
  if (row?.active !== 1) throw new Error("PLATFORM_OWNER_REQUIRED");
  return { actorId, email, displayName: input.displayName.trim() || email };
}

export async function listPlatformMarkets(): Promise<PlatformMarket[]> {
  await ensurePlatformSchema();
  const db = database();
  const rows = await db.prepare(`SELECT m.id AS marketId, m.name AS marketName, m.slug AS marketSlug,
    m.status, m.created_at AS createdAt, m.updated_at AS updatedAt,
    mm.actor_id AS managerActorId, mm.email AS managerEmail, mm.display_name AS managerName, mm.role AS managerRole
    FROM pos_markets m LEFT JOIN pos_market_memberships mm ON mm.market_id = m.id AND mm.role = 'manager' AND mm.active = 1
    ORDER BY m.created_at DESC`).all<Omit<PlatformMarket, "permissions">>();
  return Promise.all(rows.results.map(async (market) => {
    if (!market.managerActorId) return { ...market, permissions: [] };
    const permissions = await db.prepare(`SELECT permission FROM pos_manager_permissions WHERE market_id = ? AND actor_id = ? ORDER BY permission`)
      .bind(market.marketId, market.managerActorId).all<{ permission: ManagerPermission }>();
    return { ...market, permissions: permissions.results.map((row) => row.permission) };
  }));
}

function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "market"; }

export async function createPlatformMarket(input: { ownerActorId: string; name: string; managerEmail: string; managerName: string; permissions: ManagerPermission[] }) {
  await ensurePlatformSchema();
  const name = input.name.trim().slice(0, 120);
  const managerEmail = input.managerEmail.trim().toLowerCase();
  const managerName = input.managerName.trim().slice(0, 120) || managerEmail;
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(managerEmail)) throw new Error("PLATFORM_MARKET_INPUT_INVALID");
  const permissions = [...new Set(input.permissions)].filter((item) => MANAGER_PERMISSIONS.includes(item));
  const marketId = `market_${crypto.randomUUID()}`;
  const managerActorId = await actorIdForEmail(managerEmail);
  const now = new Date().toISOString();
  const db = database();
  await db.batch([
    db.prepare(`INSERT INTO pos_markets (id, name, slug, status, owner_actor_id, created_at, updated_at)
      VALUES (?, ?, ?, 'trial', ?, ?, ?)`).bind(marketId, name, `${slugify(name)}-${marketId.slice(-8)}`, input.ownerActorId, now, now),
    db.prepare(`INSERT INTO pos_market_memberships
      (market_id, actor_id, email, display_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'manager', 1, ?, ?)`).bind(marketId, managerActorId, managerEmail, managerName, now, now),
    db.prepare(`INSERT INTO pos_staff (tenant_id, actor_id, email, display_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'manager', 1, ?, ?)`).bind(marketId, managerActorId, managerEmail, managerName, now, now),
    ...permissions.map((permission) => db.prepare(`INSERT INTO pos_manager_permissions
      (market_id, actor_id, permission, granted_by_actor_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(marketId, managerActorId, permission, input.ownerActorId, now)),
  ]);
  return (await listPlatformMarkets()).find((market) => market.marketId === marketId)!;
}

export async function updatePlatformMarket(input: { ownerActorId: string; marketId: string; status: PlatformMarket["status"]; managerEmail: string; managerName: string; permissions: ManagerPermission[] }) {
  await ensurePlatformSchema();
  const db = database();
  const managerEmail = input.managerEmail.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(managerEmail)) throw new Error("PLATFORM_MANAGER_EMAIL_INVALID");
  const actorId = await actorIdForEmail(managerEmail);
  const now = new Date().toISOString();
  const permissions = [...new Set(input.permissions)].filter((item) => MANAGER_PERMISSIONS.includes(item));
  await db.batch([
    db.prepare("UPDATE pos_markets SET status = ?, updated_at = ? WHERE id = ?").bind(input.status, now, input.marketId),
    db.prepare("UPDATE pos_market_memberships SET active = 0, updated_at = ? WHERE market_id = ? AND role = 'manager'").bind(now, input.marketId),
    db.prepare(`INSERT INTO pos_market_memberships (market_id, actor_id, email, display_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'manager', 1, ?, ?) ON CONFLICT (market_id, actor_id) DO UPDATE SET
      email=excluded.email, display_name=excluded.display_name, role='manager', active=1, updated_at=excluded.updated_at`)
      .bind(input.marketId, actorId, managerEmail, input.managerName.trim() || managerEmail, now, now),
    db.prepare(`INSERT INTO pos_staff (tenant_id, actor_id, email, display_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'manager', 1, ?, ?) ON CONFLICT (tenant_id, actor_id) DO UPDATE SET
      email=excluded.email, display_name=excluded.display_name, role='manager', active=1, updated_at=excluded.updated_at`)
      .bind(input.marketId, actorId, managerEmail, input.managerName.trim() || managerEmail, now, now),
    db.prepare("DELETE FROM pos_manager_permissions WHERE market_id = ?").bind(input.marketId),
    ...permissions.map((permission) => db.prepare(`INSERT INTO pos_manager_permissions
      (market_id, actor_id, permission, granted_by_actor_id, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(input.marketId, actorId, permission, input.ownerActorId, now)),
  ]);
  return (await listPlatformMarkets()).find((market) => market.marketId === input.marketId)!;
}

export async function managerPermissions(marketId: string, actorId: string): Promise<ManagerPermission[]> {
  await ensurePlatformSchema();
  const result = await database().prepare("SELECT permission FROM pos_manager_permissions WHERE market_id = ? AND actor_id = ?")
    .bind(marketId, actorId).all<{ permission: ManagerPermission }>();
  return result.results.map((row) => row.permission);
}
