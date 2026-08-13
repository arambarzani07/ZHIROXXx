import { env } from "cloudflare:workers";
import { mergeConcurrentSyncState, validateMergedSyncState, type MergeRecord } from "@/lib/pos-sync-merge";
import {
  POS_APP_VERSION,
  readStoresForRole,
  writeStoresForRole,
  type PosRole,
  type ProductionStatus,
  type ServerStaffProfile,
} from "@/lib/production-contract";
import type { ManagerPermission } from "@/lib/production-contract";
import {
  SYNC_STORE_NAMES,
  type CloudSyncChange,
  type CloudSyncDelta,
  type CloudSyncMeta,
  type CloudSyncRecord,
  type CloudSyncState,
  type SyncStoreName,
} from "@/lib/sync-contract";

const TOMBSTONE = "__deleted";
let schemaPromise: Promise<void> | null = null;

type StaffRow = {
  actorId: string;
  email: string;
  displayName: string;
  role: PosRole;
  active: number;
  createdAt: string;
  updatedAt: string;
};

type MutationRow = {
  status: "pending" | "completed";
  revision: number | null;
  baseRevision: number;
  actorId: string;
  deviceId: string;
};

export class SyncConflictError extends Error {
  constructor(public readonly currentRevision: number) {
    super("SYNC_CONFLICT");
  }
}

export class SyncMergeConflictError extends SyncConflictError {
  constructor(currentRevision: number, public readonly conflicts: string[]) {
    super(currentRevision);
    this.message = "SYNC_MERGE_CONFLICT";
  }
}

function database() {
  if (!env.DB) throw new Error("SYNC_DATABASE_UNAVAILABLE");
  return env.DB;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function tombstone(recordId: string) {
  return { id: recordId, [TOMBSTONE]: true };
}

function isTombstone(payload: Record<string, unknown>) {
  return payload[TOMBSTONE] === true;
}

function finiteNumbers(payload: Record<string, unknown>, fields: string[], nonNegative = true) {
  return fields.every((field) => {
    const value = payload[field];
    return typeof value === "number" && Number.isFinite(value) && (!nonNegative || value >= 0);
  });
}

function validRecordShape(storeName: SyncStoreName, payload: Record<string, unknown>) {
  if (typeof payload.id !== "string" || !payload.id) return false;
  if (storeName === "products") {
    return typeof payload.name === "string" && typeof payload.barcode === "string" &&
      finiteNumbers(payload, ["purchasePriceIQD", "salePriceIQD", "stock", "lowStock"]);
  }
  if (storeName === "customers" || storeName === "suppliers") {
    return typeof payload.name === "string" && finiteNumbers(payload, ["balanceIQD"], false);
  }
  if (storeName === "sales" || storeName === "purchases") {
    const hasItems = Array.isArray(payload.items) || (storeName === "purchases" && typeof payload.productId === "string" && typeof payload.quantity === "number");
    return typeof payload.receiptNo === "string" && hasItems && finiteNumbers(payload, ["totalIQD", "paidIQD", "debtIQD"]);
  }
  if (storeName === "saleReturns" || storeName === "purchaseReturns") {
    return typeof payload.sourceId === "string" && (payload.items === undefined || Array.isArray(payload.items)) && finiteNumbers(payload, ["totalIQD"]);
  }
  if (storeName === "cashEntries") {
    return (payload.direction === "in" || payload.direction === "out") && finiteNumbers(payload, ["amountIQD"]);
  }
  if (storeName === "cashShifts") {
    return typeof payload.operatorId === "string" && typeof payload.openedAt === "string" &&
      (payload.status === "open" || payload.status === "closed") && finiteNumbers(payload, ["openingCashIQD"]);
  }
  if (storeName === "journalEntries") return Array.isArray(payload.lines);
  if (storeName === "users") {
    return typeof payload.name === "string" && typeof payload.pinHash === "string" &&
      ["owner", "manager", "cashier", "accountant"].includes(String(payload.role));
  }
  if (storeName === "settings") return payload.id === "main";
  return true;
}

function recordKey(record: Pick<CloudSyncRecord, "storeName" | "recordId">) {
  return `${record.storeName}\u0000${record.recordId}`;
}

function toStaff(row: StaffRow): ServerStaffProfile {
  return {
    actorId: row.actorId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    active: row.active === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function actorIdForEmail(email: string) {
  return sha256(email.trim().toLowerCase());
}

export async function ensureSyncSchema() {
  if (schemaPromise) return schemaPromise;
  const db = database();
  schemaPromise = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_sync_mutations (
      tenant_id TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      revision INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
      device_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (tenant_id, mutation_id),
      UNIQUE (tenant_id, revision)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_sync_changes (
      tenant_id TEXT NOT NULL,
      mutation_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation = 'upsert'),
      payload_json TEXT NOT NULL,
      digest TEXT NOT NULL,
      PRIMARY KEY (tenant_id, mutation_id, store_name, record_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_staff (
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier', 'accountant')),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, actor_id),
      UNIQUE (tenant_id, email)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_manager_permissions (
      market_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted_by_actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (market_id, actor_id, permission)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_devices (
      tenant_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      label TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      app_version INTEGER NOT NULL,
      last_revision INTEGER NOT NULL DEFAULT 0,
      pending_count INTEGER NOT NULL DEFAULT 0,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, device_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pos_restore_points (
      tenant_id TEXT NOT NULL,
      day TEXT NOT NULL,
      revision INTEGER NOT NULL,
      record_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, day)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_sync_mutations_status_revision_idx ON pos_sync_mutations (tenant_id, status, revision)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_sync_changes_record_idx ON pos_sync_changes (tenant_id, store_name, record_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_devices_seen_idx ON pos_devices (tenant_id, last_seen_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_restore_points_revision_idx ON pos_restore_points (tenant_id, revision)"),
    db.prepare("CREATE INDEX IF NOT EXISTS pos_manager_permissions_actor_idx ON pos_manager_permissions (actor_id, market_id)"),
  ]).then(() => undefined).catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

async function currentRevision(tenantId: string) {
  const row = await database().prepare(
    "SELECT COALESCE(MAX(revision), 0) AS revision FROM pos_sync_mutations WHERE tenant_id = ? AND status = 'completed'",
  ).bind(tenantId).first<{ revision: number }>();
  return Number(row?.revision ?? 0);
}

async function latestCompletedAt(tenantId: string, revision: number) {
  const row = await database().prepare(`SELECT completed_at AS completedAt FROM pos_sync_mutations
    WHERE tenant_id = ? AND status = 'completed' AND revision <= ? ORDER BY revision DESC LIMIT 1`)
    .bind(tenantId, revision).first<{ completedAt: string | null }>();
  return row?.completedAt ?? null;
}

async function mutation(tenantId: string, mutationId: string) {
  return database().prepare(`SELECT status, revision, base_revision AS baseRevision, actor_id AS actorId, device_id AS deviceId
    FROM pos_sync_mutations WHERE tenant_id = ? AND mutation_id = ?`)
    .bind(tenantId, mutationId).first<MutationRow>();
}

export async function authorizeStaff(input: { email: string; displayName: string; tenantId: string; marketName: string; role: ServerStaffProfile["role"] }): Promise<ServerStaffProfile | null> {
  await ensureSyncSchema();
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim().slice(0, 120) || email;
  const actorId = await actorIdForEmail(email);
  const now = new Date().toISOString();
  const db = database();
  await db.prepare(`INSERT INTO pos_staff
    (tenant_id, actor_id, email, display_name, role, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT (tenant_id, actor_id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name,
      role = excluded.role, active = 1, updated_at = excluded.updated_at`)
    .bind(input.tenantId, actorId, email, displayName, input.role, now, now).run();
  const row = await db.prepare(`SELECT actor_id AS actorId, email, display_name AS displayName, role, active,
      created_at AS createdAt, updated_at AS updatedAt
    FROM pos_staff WHERE tenant_id = ? AND actor_id = ?`)
    .bind(input.tenantId, actorId).first<StaffRow>();
  if (!row || row.active !== 1) return null;
  if (row.displayName !== displayName || row.email !== email) {
    await db.prepare("UPDATE pos_staff SET email = ?, display_name = ?, updated_at = ? WHERE tenant_id = ? AND actor_id = ?")
      .bind(email, displayName, now, input.tenantId, actorId).run();
    row.email = email;
    row.displayName = displayName;
    row.updatedAt = now;
  }
  const permissions = row.role === "manager"
    ? (await db.prepare("SELECT permission FROM pos_manager_permissions WHERE market_id = ? AND actor_id = ?")
      .bind(input.tenantId, actorId).all<{ permission: ManagerPermission }>()).results.map((item) => item.permission)
    : undefined;
  return { ...toStaff(row), tenantId: input.tenantId, marketName: input.marketName, permissions };
}

async function readRawStateAt(tenantId: string, revision: number): Promise<CloudSyncRecord[]> {
  if (revision <= 0) return [];
  const result = await database().prepare(`WITH ranked AS (
      SELECT c.store_name AS storeName, c.record_id AS recordId, c.payload_json AS payloadJson,
        c.digest AS digest, m.revision AS revision,
        ROW_NUMBER() OVER (PARTITION BY c.store_name, c.record_id ORDER BY m.revision DESC) AS rowNumber
      FROM pos_sync_changes c
      INNER JOIN pos_sync_mutations m ON m.tenant_id = c.tenant_id AND m.mutation_id = c.mutation_id
      WHERE c.tenant_id = ? AND m.status = 'completed' AND m.revision <= ?
    )
    SELECT storeName, recordId, payloadJson, digest, revision
    FROM ranked WHERE rowNumber = 1 ORDER BY storeName, recordId`)
    .bind(tenantId, revision).all<{
      storeName: SyncStoreName;
      recordId: string;
      payloadJson: string;
      digest: string;
      revision: number;
    }>();
  return result.results.flatMap((row) => {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    if (isTombstone(payload)) return [];
    return [{
      storeName: row.storeName,
      recordId: row.recordId,
      payload,
      digest: row.digest,
      revision: Number(row.revision),
    }];
  });
}

function roleMeta(actor: ServerStaffProfile, revision: number, updatedAt: string | null): CloudSyncMeta {
  const readStores = readStoresForActor(actor);
  return {
    revision,
    updatedAt,
    role: actor.role,
    readStores,
    writeStores: writeStoresForActor(actor),
  };
}

function permissionStores(actor: ServerStaffProfile) {
  const permissions = new Set(actor.permissions ?? []);
  const stores = new Set<SyncStoreName>(["settings", "users", "audit"]);
  const add = (...items: SyncStoreName[]) => items.forEach((item) => stores.add(item));
  if (permissions.has("manage_products")) add("products", "losses", "stockAdjustments");
  if (permissions.has("manage_sales")) add("customers", "products", "sales", "saleReturns", "cashShifts");
  if (permissions.has("manage_purchases")) add("suppliers", "products", "purchases", "purchaseReturns");
  if (permissions.has("manage_accounting") || permissions.has("view_reports")) add("customers", "suppliers", "sales", "saleReturns", "purchases", "purchaseReturns", "expenses", "cashEntries", "losses", "cashShifts", "journalEntries", "accounts");
  return [...stores];
}

function readStoresForActor(actor: ServerStaffProfile): SyncStoreName[] {
  return actor.role === "manager" ? permissionStores(actor) : readStoresForRole(actor.role);
}

function writeStoresForActor(actor: ServerStaffProfile): SyncStoreName[] {
  if (actor.role !== "manager") return writeStoresForRole(actor.role);
  const permissions = new Set(actor.permissions ?? []);
  return permissionStores(actor).filter((store) => {
    if (store === "users") return permissions.has("manage_staff");
    if (store === "settings") return permissions.has("manage_settings");
    if (store === "audit") return true;
    if (permissions.has("view_reports") && !permissions.has("manage_accounting") && ["expenses", "cashEntries", "journalEntries", "accounts"].includes(store)) return false;
    return true;
  });
}

export async function readCloudSyncState(actor: ServerStaffProfile, requestedRevision?: number): Promise<CloudSyncState> {
  await ensureSyncSchema();
  const latest = await currentRevision(actor.tenantId);
  const revision = requestedRevision === undefined ? latest : requestedRevision;
  if (!Number.isInteger(revision) || revision < 0 || revision > latest) throw new SyncConflictError(latest);
  const includedStores = readStoresForActor(actor);
  const allowed = new Set(includedStores);
  const records = (await readRawStateAt(actor.tenantId, revision)).filter((record) => allowed.has(record.storeName));
  return { ...roleMeta(actor, revision, await latestCompletedAt(actor.tenantId, revision)), records, includedStores };
}

export async function readCloudSyncMeta(actor: ServerStaffProfile): Promise<CloudSyncMeta> {
  await ensureSyncSchema();
  const revision = await currentRevision(actor.tenantId);
  return roleMeta(actor, revision, await latestCompletedAt(actor.tenantId, revision));
}

async function diffStates(from: CloudSyncRecord[], to: CloudSyncRecord[], stores: SyncStoreName[]): Promise<CloudSyncChange[]> {
  const allowed = new Set(stores);
  const fromMap = new Map(from.filter((record) => allowed.has(record.storeName)).map((record) => [recordKey(record), record]));
  const toMap = new Map(to.filter((record) => allowed.has(record.storeName)).map((record) => [recordKey(record), record]));
  const changes: CloudSyncChange[] = [];
  for (const [key, target] of toMap) {
    const previous = fromMap.get(key);
    if (previous?.digest !== target.digest) changes.push({
      storeName: target.storeName,
      recordId: target.recordId,
      operation: "upsert",
      payload: target.payload,
      digest: target.digest,
    });
    fromMap.delete(key);
  }
  for (const previous of fromMap.values()) changes.push({
    storeName: previous.storeName,
    recordId: previous.recordId,
    operation: "delete",
    payload: null,
    digest: await sha256(tombstone(previous.recordId)),
  });
  return changes;
}

export async function readCloudSyncDelta(actor: ServerStaffProfile, since: number): Promise<CloudSyncDelta> {
  await ensureSyncSchema();
  const revision = await currentRevision(actor.tenantId);
  if (!Number.isInteger(since) || since < 0 || since > revision) throw new SyncConflictError(revision);
  const includedStores = readStoresForActor(actor);
  const [base, current, mergedRow, updatedAt] = await Promise.all([
    readRawStateAt(actor.tenantId, since),
    readRawStateAt(actor.tenantId, revision),
    database().prepare(`SELECT COUNT(*) AS count FROM pos_sync_mutations
      WHERE tenant_id = ? AND status = 'completed' AND revision > ? AND base_revision < revision - 1`)
      .bind(actor.tenantId, since).first<{ count: number }>(),
    latestCompletedAt(actor.tenantId, revision),
  ]);
  return {
    ...roleMeta(actor, revision, updatedAt),
    changes: await diffStates(base, current, includedStores),
    includedStores,
    merged: Number(mergedRow?.count ?? 0) > 0,
  };
}

async function registerDevice(input: {
  deviceId: string;
  deviceLabel: string;
  appVersion: number;
  pendingCount: number;
  actor: ServerStaffProfile;
  revision?: number;
}) {
  if (input.deviceId === "cloud-restore") return;
  const now = new Date().toISOString();
  await database().prepare(`INSERT INTO pos_devices
      (tenant_id, device_id, label, actor_id, actor_name, app_version, last_revision, pending_count, conflict_count, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT (tenant_id, device_id) DO UPDATE SET
      label = excluded.label, actor_id = excluded.actor_id, actor_name = excluded.actor_name,
      app_version = excluded.app_version, last_revision = MAX(pos_devices.last_revision, excluded.last_revision),
      pending_count = excluded.pending_count, last_seen_at = excluded.last_seen_at`)
    .bind(
      input.actor.tenantId,
      input.deviceId,
      input.deviceLabel.trim().slice(0, 60) || "کاشێر",
      input.actor.actorId,
      input.actor.displayName,
      input.appVersion,
      input.revision ?? 0,
      Math.max(0, input.pendingCount),
      now,
    ).run();
}

async function incrementDeviceConflict(tenantId: string, deviceId: string) {
  if (deviceId === "cloud-restore") return;
  await database().prepare(`UPDATE pos_devices SET conflict_count = conflict_count + 1, last_seen_at = ?
    WHERE tenant_id = ? AND device_id = ?`)
    .bind(new Date().toISOString(), tenantId, deviceId).run();
}

async function completeDeviceSync(deviceId: string, revision: number, actor: ServerStaffProfile) {
  if (deviceId === "cloud-restore") return;
  await database().prepare(`UPDATE pos_devices SET actor_id = ?, actor_name = ?, app_version = ?,
      last_revision = ?, pending_count = 0, last_seen_at = ?
    WHERE tenant_id = ? AND device_id = ?`)
    .bind(actor.actorId, actor.displayName, POS_APP_VERSION, revision, new Date().toISOString(), actor.tenantId, deviceId).run();
}

export async function startSyncMutation(input: {
  mutationId: string;
  baseRevision: number;
  deviceId: string;
  deviceLabel: string;
  appVersion: number;
  pendingCount: number;
  actor: ServerStaffProfile;
}) {
  await ensureSyncSchema();
  await registerDevice(input);
  const existing = await mutation(input.actor.tenantId, input.mutationId);
  if (existing) {
    if (existing.actorId !== input.actor.actorId) throw new Error("SYNC_MUTATION_ACCESS_DENIED");
    return { status: existing.status, revision: existing.revision };
  }
  const revision = await currentRevision(input.actor.tenantId);
  if (input.baseRevision > revision) throw new SyncConflictError(revision);
  await database().prepare(`INSERT OR IGNORE INTO pos_sync_mutations
    (tenant_id, mutation_id, base_revision, revision, status, device_id, actor_id, started_at, completed_at)
    VALUES (?, ?, ?, NULL, 'pending', ?, ?, ?, NULL)`)
    .bind(input.actor.tenantId, input.mutationId, input.baseRevision, input.deviceId, input.actor.actorId, new Date().toISOString()).run();
  const created = await mutation(input.actor.tenantId, input.mutationId);
  if (!created || created.actorId !== input.actor.actorId) throw new Error("SYNC_START_FAILED");
  return { status: created.status, revision: created.revision };
}

async function stagedChanges(tenantId: string, mutationId: string): Promise<CloudSyncChange[]> {
  const rows = await database().prepare(`SELECT store_name AS storeName, record_id AS recordId,
      payload_json AS payloadJson, digest FROM pos_sync_changes
    WHERE tenant_id = ? AND mutation_id = ? ORDER BY store_name, record_id`)
    .bind(tenantId, mutationId).all<{ storeName: SyncStoreName; recordId: string; payloadJson: string; digest: string }>();
  return rows.results.map((row) => {
    const payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
    return {
      storeName: row.storeName,
      recordId: row.recordId,
      operation: isTombstone(payload) ? "delete" : "upsert",
      payload: isTombstone(payload) ? null : payload,
      digest: row.digest,
    };
  });
}

export async function stageSyncChanges(actor: ServerStaffProfile, mutationId: string, changes: CloudSyncChange[]) {
  await ensureSyncSchema();
  const current = await mutation(actor.tenantId, mutationId);
  if (!current) throw new Error("SYNC_MUTATION_NOT_FOUND");
  if (current.actorId !== actor.actorId) throw new Error("SYNC_MUTATION_ACCESS_DENIED");
  if (current.status === "completed") return { accepted: changes.length, completed: true };
  const writable = new Set(writeStoresForActor(actor));
  const verified = await Promise.all(changes.map(async (change) => {
    if (!writable.has(change.storeName)) throw new Error("SYNC_STORE_WRITE_DENIED");
    const payload = change.operation === "delete" ? tombstone(change.recordId) : change.payload;
    if (!payload || payload.id !== change.recordId) throw new Error("SYNC_RECORD_INVALID");
    if (change.operation === "upsert" && !validRecordShape(change.storeName, payload)) throw new Error("SYNC_RECORD_SHAPE_INVALID");
    const digest = await sha256(payload);
    if (digest !== change.digest) throw new Error("SYNC_DIGEST_INVALID");
    return { ...change, payload, digest };
  }));
  if (verified.length) {
    const db = database();
    await db.batch(verified.map((change) => db.prepare(`INSERT INTO pos_sync_changes
      (tenant_id, mutation_id, store_name, record_id, operation, payload_json, digest)
      VALUES (?, ?, ?, ?, 'upsert', ?, ?)
      ON CONFLICT (tenant_id, mutation_id, store_name, record_id)
      DO UPDATE SET payload_json = excluded.payload_json, digest = excluded.digest`)
      .bind(actor.tenantId, mutationId, change.storeName, change.recordId, JSON.stringify(change.payload), change.digest)));
  }
  return { accepted: verified.length, completed: false };
}

function applyChanges(records: CloudSyncRecord[], changes: CloudSyncChange[]): CloudSyncRecord[] {
  const map = new Map(records.map((record) => [recordKey(record), { ...record, payload: { ...record.payload } }]));
  for (const change of changes) {
    const key = recordKey(change);
    if (change.operation === "delete") map.delete(key);
    else if (change.payload) map.set(key, {
      storeName: change.storeName,
      recordId: change.recordId,
      payload: { ...change.payload },
      digest: change.digest,
      revision: 0,
    });
  }
  return Array.from(map.values());
}

async function ensureDigests(records: MergeRecord[]): Promise<CloudSyncRecord[]> {
  return Promise.all(records.map(async (record) => ({
    ...record,
    payload: { ...record.payload },
    digest: /^[a-f0-9]{64}$/.test(record.digest) ? record.digest : await sha256(record.payload),
    revision: 0,
  })));
}

async function syncStaffFromUsers(actor: ServerStaffProfile, records: CloudSyncRecord[]) {
  if (actor.role !== "owner" && actor.role !== "manager") return;
  const users = records.filter((record) => record.storeName === "users" && typeof record.payload.email === "string");
  if (!users.length) return;
  const now = new Date().toISOString();
  const db = database();
  const statements = [];
  for (const user of users) {
    const email = String(user.payload.email).trim().toLowerCase();
    const role = user.payload.role;
    if (!email || !["owner", "manager", "cashier", "accountant"].includes(String(role))) continue;
    const actorId = await actorIdForEmail(email);
    if (actor.role === "manager" && (role === "owner" || role === "manager")) continue;
    const isCurrentOwner = actor.role === "owner" && actorId === actor.actorId;
    statements.push(db.prepare(`INSERT INTO pos_staff
        (tenant_id, actor_id, email, display_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, actor_id) DO UPDATE SET
        email = excluded.email, display_name = excluded.display_name, role = excluded.role,
        active = excluded.active, updated_at = excluded.updated_at`)
      .bind(
        actor.tenantId,
        actorId,
        email,
        String(user.payload.name ?? email).slice(0, 120),
        isCurrentOwner ? "owner" : String(role),
        isCurrentOwner ? 1 : user.payload.active === false ? 0 : 1,
        now,
        now,
      ));
  }
  for (let offset = 0; offset < statements.length; offset += 75) {
    await db.batch(statements.slice(offset, offset + 75));
  }
}

async function saveRestorePoint(tenantId: string, revision: number, recordCount: number, now: string) {
  const day = now.slice(0, 10);
  const db = database();
  await db.batch([
    db.prepare(`INSERT INTO pos_restore_points (tenant_id, day, revision, record_count, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, day) DO UPDATE SET
        revision = excluded.revision, record_count = excluded.record_count, created_at = excluded.created_at`)
      .bind(tenantId, day, revision, recordCount, now),
    db.prepare(`DELETE FROM pos_restore_points WHERE tenant_id = ? AND day NOT IN (
      SELECT day FROM pos_restore_points WHERE tenant_id = ? ORDER BY day DESC LIMIT 30
    )`).bind(tenantId, tenantId),
  ]);
}

async function stageMergedChanges(tenantId: string, mutationId: string, changes: CloudSyncChange[]) {
  const db = database();
  await db.prepare(`DELETE FROM pos_sync_changes WHERE tenant_id = ? AND mutation_id = ? AND EXISTS (
    SELECT 1 FROM pos_sync_mutations WHERE tenant_id = ? AND mutation_id = ? AND status = 'pending'
  )`).bind(tenantId, mutationId, tenantId, mutationId).run();
  for (let offset = 0; offset < changes.length; offset += 75) {
    const chunk = changes.slice(offset, offset + 75);
    await db.batch(chunk.map((change) => {
      const payload = change.operation === "delete" ? tombstone(change.recordId) : change.payload;
      return db.prepare(`INSERT INTO pos_sync_changes
          (tenant_id, mutation_id, store_name, record_id, operation, payload_json, digest)
        SELECT ?, ?, ?, ?, 'upsert', ?, ? WHERE EXISTS (
          SELECT 1 FROM pos_sync_mutations WHERE tenant_id = ? AND mutation_id = ? AND status = 'pending'
        )
        ON CONFLICT (tenant_id, mutation_id, store_name, record_id)
        DO UPDATE SET payload_json = excluded.payload_json, digest = excluded.digest`)
        .bind(tenantId, mutationId, change.storeName, change.recordId, JSON.stringify(payload), change.digest, tenantId, mutationId);
    }));
  }
}

async function completePendingMutation(input: {
  tenantId: string;
  mutationId: string;
  currentRevision: number;
  nextRevision: number;
  completedAt: string;
}) {
  const db = database();
  const completed = await db.prepare(`UPDATE pos_sync_mutations SET status = 'completed', revision = ?, completed_at = ?
    WHERE tenant_id = ? AND mutation_id = ? AND status = 'pending' AND ? = (
      SELECT COALESCE(MAX(revision), 0) FROM pos_sync_mutations WHERE tenant_id = ? AND status = 'completed'
    ) RETURNING revision`)
    .bind(input.nextRevision, input.completedAt, input.tenantId, input.mutationId, input.currentRevision, input.tenantId)
    .first<{ revision?: number }>();
  return Number(completed?.revision ?? 0) === input.nextRevision;
}

export async function finalizeSyncMutation(actor: ServerStaffProfile, mutationId: string) {
  await ensureSyncSchema();
  const existing = await mutation(actor.tenantId, mutationId);
  if (!existing) throw new Error("SYNC_MUTATION_NOT_FOUND");
  if (existing.actorId !== actor.actorId) throw new Error("SYNC_MUTATION_ACCESS_DENIED");
  if (existing.status === "completed") return { revision: Number(existing.revision), merged: existing.baseRevision < Number(existing.revision) - 1 };
  const localChanges = await stagedChanges(actor.tenantId, mutationId);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await currentRevision(actor.tenantId);
    const [base, remote] = await Promise.all([readRawStateAt(actor.tenantId, existing.baseRevision), readRawStateAt(actor.tenantId, latest)]);
    const local = applyChanges(base, localChanges);
    let mergedRecords: CloudSyncRecord[];
    if (latest === existing.baseRevision) {
      mergedRecords = applyChanges(remote, localChanges);
    } else {
      const merged = mergeConcurrentSyncState({
        base,
        local,
        remote,
        writableStores: writeStoresForActor(actor),
      });
      if (merged.conflicts.length) {
        await incrementDeviceConflict(actor.tenantId, existing.deviceId);
        throw new SyncMergeConflictError(latest, merged.conflicts.slice(0, 12));
      }
      mergedRecords = await ensureDigests(merged.records);
    }
    mergedRecords = await ensureDigests(mergedRecords);
    const violations = validateMergedSyncState(mergedRecords);
    if (violations.length) throw new Error(violations[0]);
    const changes = await diffStates(remote, mergedRecords, [...SYNC_STORE_NAMES]);
    const completedAt = new Date().toISOString();
    try {
      if (latest !== existing.baseRevision) await stageMergedChanges(actor.tenantId, mutationId, changes);
      const completed = await completePendingMutation({
        tenantId: actor.tenantId,
        mutationId,
        currentRevision: latest,
        nextRevision: latest + 1,
        completedAt,
      });
      if (!completed) {
        const raced = await mutation(actor.tenantId, mutationId);
        if (raced?.status === "completed") return {
          revision: Number(raced.revision),
          merged: existing.baseRevision < Number(raced.revision) - 1,
        };
        continue;
      }
      await Promise.all([
        syncStaffFromUsers(actor, mergedRecords),
        saveRestorePoint(actor.tenantId, latest + 1, mergedRecords.length, completedAt),
        completeDeviceSync(existing.deviceId, latest + 1, actor),
      ]);
      return { revision: latest + 1, merged: latest > existing.baseRevision };
    } catch (error) {
      const raced = await mutation(actor.tenantId, mutationId);
      if (raced?.status === "completed") return {
        revision: Number(raced.revision),
        merged: existing.baseRevision < Number(raced.revision) - 1,
      };
      if (attempt === 2) throw error;
    }
  }
  throw new SyncConflictError(await currentRevision(actor.tenantId));
}

export async function readProductionStatus(actor: ServerStaffProfile): Promise<ProductionStatus> {
  await ensureSyncSchema();
  const elevated = actor.role === "owner" || actor.role === "manager";
  const db = database();
  const [revision, devicesResult, restoreResult, staffResult] = await Promise.all([
    currentRevision(actor.tenantId),
    db.prepare(`SELECT device_id AS deviceId, label, actor_id AS actorId, actor_name AS actorName,
        app_version AS appVersion, last_revision AS lastRevision, pending_count AS pendingCount,
        conflict_count AS conflictCount, last_seen_at AS lastSeenAt
      FROM pos_devices WHERE tenant_id = ? ${elevated ? "" : "AND actor_id = ?"} ORDER BY last_seen_at DESC`)
      .bind(...(elevated ? [actor.tenantId] : [actor.tenantId, actor.actorId])).all<ProductionStatus["devices"][number]>(),
    db.prepare("SELECT day, revision, record_count AS recordCount, created_at AS createdAt FROM pos_restore_points WHERE tenant_id = ? ORDER BY day DESC LIMIT 30")
      .bind(actor.tenantId).all<ProductionStatus["restorePoints"][number]>(),
    db.prepare(`SELECT actor_id AS actorId, email, display_name AS displayName, role, active,
        created_at AS createdAt, updated_at AS updatedAt FROM pos_staff
      WHERE tenant_id = ? ${elevated ? "" : "AND actor_id = ?"} ORDER BY display_name`)
      .bind(...(elevated ? [actor.tenantId] : [actor.tenantId, actor.actorId])).all<StaffRow>(),
  ]);
  return {
    actor,
    currentRevision: revision,
    devices: devicesResult.results.map((device) => ({
      ...device,
      appVersion: Number(device.appVersion),
      lastRevision: Number(device.lastRevision),
      pendingCount: Number(device.pendingCount),
      conflictCount: Number(device.conflictCount),
    })),
    restorePoints: restoreResult.results.map((point) => ({
      ...point,
      revision: Number(point.revision),
      recordCount: Number(point.recordCount),
    })),
    staff: staffResult.results.map((row) => ({ ...toStaff(row), tenantId: actor.tenantId, marketName: actor.marketName })),
    appVersion: POS_APP_VERSION,
  };
}

export async function restoreCloudRevision(actor: ServerStaffProfile, targetRevision: number) {
  if (actor.role !== "owner") throw new Error("RESTORE_OWNER_REQUIRED");
  await ensureSyncSchema();
  const latest = await currentRevision(actor.tenantId);
  if (!Number.isInteger(targetRevision) || targetRevision < 0 || targetRevision >= latest) throw new Error("RESTORE_REVISION_INVALID");
  const [current, target] = await Promise.all([readRawStateAt(actor.tenantId, latest), readRawStateAt(actor.tenantId, targetRevision)]);
  const changes = await diffStates(current, target, [...SYNC_STORE_NAMES]);
  const mutationId = `restore_${crypto.randomUUID()}`;
  await startSyncMutation({
    mutationId,
    baseRevision: latest,
    deviceId: "cloud-restore",
    deviceLabel: "Cloud restore",
    appVersion: POS_APP_VERSION,
    pendingCount: changes.length,
    actor,
  });
  for (let offset = 0; offset < changes.length; offset += 75) {
    await stageSyncChanges(actor, mutationId, changes.slice(offset, offset + 75));
  }
  const finalized = await finalizeSyncMutation(actor, mutationId);
  return { ...finalized, restoredFromRevision: targetRevision, changedRecords: changes.length };
}
