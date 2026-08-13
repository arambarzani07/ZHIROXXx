"use client";

import {
  applyCloudDelta,
  createId,
  getOrCreateSyncMeta,
  listRecords,
  readSyncBaseline,
  readSyncRecords,
  replaceLocalStateFromCloud,
  replaceSyncBaseline,
  saveSyncMeta,
  type SyncMeta,
} from "@/lib/pos-db";
import { POS_APP_VERSION } from "@/lib/production-contract";
import { getSelectedMarketId, setSelectedMarketId } from "@/lib/market-client";
import {
  SYNC_STORE_NAMES,
  type CloudSyncChange,
  type CloudSyncDelta,
  type CloudSyncMeta,
  type CloudSyncState,
  type SyncStoreName,
} from "@/lib/sync-contract";

type OutboxRecord = { id: string };

export type PosSyncPhase = "synced" | "offline" | "syncing" | "pending" | "conflict" | "unauthorized" | "error";

export type PosSyncResult = {
  phase: PosSyncPhase;
  pending: number;
  revision: number;
  lastSyncedAt: string | null;
  remoteRevision?: number;
  pulled?: boolean;
  merged?: boolean;
  role?: CloudSyncMeta["role"];
  message?: string;
};

class SyncRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly currentRevision?: number,
  ) {
    super(message);
  }
}

let activeSync: Promise<PosSyncResult> | null = null;

function withBrowserSyncLock(operation: () => Promise<PosSyncResult>): Promise<PosSyncResult> {
  if ("locks" in navigator) return navigator.locks.request("zhirox-pos-cloud-sync", operation).then((value) => value);
  return operation();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

async function sha256(value: unknown): Promise<string> {
  const text = JSON.stringify(canonicalize(value));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const marketId = getSelectedMarketId();
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(marketId ? { "X-Zhirox-Market-Id": marketId } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new SyncRequestError(
      response.status,
      typeof payload.error === "string" ? payload.error : "SYNC_REQUEST_FAILED",
      typeof payload.currentRevision === "number" ? payload.currentRevision : undefined,
    );
  }
  return payload as T;
}

export async function switchCloudMarket(marketId: string): Promise<CloudSyncState> {
  setSelectedMarketId(marketId);
  const state = await remoteState();
  await replaceLocalStateFromCloud(state);
  return state;
}

async function remoteMeta(): Promise<CloudSyncMeta> {
  const meta = await requestJson<CloudSyncMeta>("/api/sync?mode=meta");
  if (!Number.isInteger(meta.revision) || meta.revision < 0) throw new Error("SYNC_META_INVALID");
  return meta;
}

async function remoteState(revision?: number): Promise<CloudSyncState> {
  const suffix = revision === undefined ? "" : `?revision=${revision}`;
  const state = await requestJson<CloudSyncState>(`/api/sync${suffix}`);
  if (!Number.isInteger(state.revision) || state.revision < 0 || !Array.isArray(state.records)) {
    throw new Error("SYNC_STATE_INVALID");
  }
  return state;
}

async function remoteDelta(since: number): Promise<CloudSyncDelta> {
  const delta = await requestJson<CloudSyncDelta>(`/api/sync?mode=delta&since=${since}`);
  if (!Number.isInteger(delta.revision) || delta.revision < since || !Array.isArray(delta.changes)) {
    throw new Error("SYNC_DELTA_INVALID");
  }
  return delta;
}

async function postSync<T>(body: Record<string, unknown>): Promise<T> {
  return requestJson<T>("/api/sync", { method: "POST", body: JSON.stringify(body) });
}

function withoutInFlight(meta: SyncMeta): SyncMeta {
  return {
    ...meta,
    inFlightMutationId: undefined,
    inFlightBaseRevision: undefined,
    inFlightOutboxIds: undefined,
  };
}

async function digestLocalChanges(writableStores: SyncStoreName[]): Promise<CloudSyncChange[]> {
  const [source, baseline] = await Promise.all([readSyncRecords(), readSyncBaseline()]);
  const writable = new Set(writableStores);
  const baselineMap = new Map(baseline
    .filter((record) => writable.has(record.storeName))
    .map((record) => [`${record.storeName}\u0000${record.recordId}`, record]));
  const baselineDigests = new Map(Array.from(baselineMap, ([key, record]) => [key, record.digest]));
  const writableSource = source.filter((record) => writable.has(record.storeName));
  const changes: CloudSyncChange[] = [];

  for (let offset = 0; offset < writableSource.length; offset += 100) {
    const batch = writableSource.slice(offset, offset + 100);
    const digested = await Promise.all(batch.map(async ({ storeName, payload }): Promise<CloudSyncChange | null> => {
      if (typeof payload.id !== "string" || !payload.id) throw new Error("SYNC_LOCAL_RECORD_INVALID");
      const key = `${storeName}\u0000${payload.id}`;
      const digest = await sha256(payload);
      baselineMap.delete(key);
      if (baselineDigests.get(key) === digest) return null;
      return {
        storeName,
        recordId: payload.id,
        operation: "upsert" as const,
        payload,
        digest,
      };
    }));
    changes.push(...digested.filter((record): record is CloudSyncChange => record !== null));
  }

  for (const record of baselineMap.values()) {
    changes.push({
      storeName: record.storeName,
      recordId: record.recordId,
      operation: "delete",
      payload: null,
      digest: await sha256({ id: record.recordId, __deleted: true }),
    });
  }
  return changes;
}

function result(meta: SyncMeta, phase: PosSyncPhase, pending: number, extra: Partial<PosSyncResult> = {}): PosSyncResult {
  return {
    phase,
    pending,
    revision: meta.revision,
    lastSyncedAt: meta.lastSyncedAt,
    ...extra,
  };
}

async function applyDelta(delta: CloudSyncDelta, outboxIds: string[]): Promise<SyncMeta> {
  return applyCloudDelta({
    changes: delta.changes,
    revision: delta.revision,
    updatedAt: delta.updatedAt,
    outboxIds,
    role: delta.role,
    includedStores: delta.includedStores,
  });
}

function sameStores(left: SyncStoreName[] | undefined, right: SyncStoreName[]) {
  if (!left) return true;
  return [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

async function ensureBaseline(meta: SyncMeta): Promise<void> {
  if (meta.baselineRevision === meta.revision) return;
  const base = await remoteState(meta.revision);
  await replaceSyncBaseline(base.records, base.revision);
}

async function resumeCompletedMutation(meta: SyncMeta): Promise<SyncMeta> {
  if (!meta.inFlightMutationId || meta.inFlightBaseRevision === undefined) return meta;
  const started = await postSync<{ status: "pending" | "completed"; revision: number | null }>({
    action: "start",
    mutationId: meta.inFlightMutationId,
    baseRevision: meta.inFlightBaseRevision,
    deviceId: meta.deviceId,
    deviceLabel: meta.deviceLabel,
    appVersion: POS_APP_VERSION,
    pendingCount: meta.inFlightOutboxIds?.length ?? 0,
  });
  if (started.status !== "completed" || started.revision === null) return meta;
  const delta = await remoteDelta(meta.revision);
  return applyDelta(delta, meta.inFlightOutboxIds ?? []);
}

async function runSync(): Promise<PosSyncResult> {
  let meta = await getOrCreateSyncMeta();
  let outbox = await listRecords<OutboxRecord>("outbox");
  if (!navigator.onLine) return result(meta, "offline", outbox.length);

  try {
    if (meta.inFlightMutationId) meta = await resumeCompletedMutation(meta);
    outbox = await listRecords<OutboxRecord>("outbox");
    const cloudMeta = await remoteMeta();
    const writableStores = cloudMeta.writeStores ?? [...SYNC_STORE_NAMES];
    const readableStores = cloudMeta.readStores ?? [...SYNC_STORE_NAMES];

    if ((meta.serverRole && cloudMeta.role && meta.serverRole !== cloudMeta.role) || !sameStores(meta.readStores, readableStores)) {
      if (outbox.length) return result(meta, "conflict", outbox.length, {
        remoteRevision: cloudMeta.revision,
        role: cloudMeta.role,
        message: "SERVER_ROLE_CHANGED_WITH_LOCAL_PENDING",
      });
      const cloud = await remoteState();
      await replaceLocalStateFromCloud(cloud);
      meta = await getOrCreateSyncMeta();
      return result(meta, "synced", 0, { pulled: true, role: cloud.role });
    }

    if (cloudMeta.revision < meta.revision) {
      return result(meta, "conflict", outbox.length, {
        remoteRevision: cloudMeta.revision,
        role: cloudMeta.role,
        message: "LOCAL_REVISION_AHEAD",
      });
    }

    if (!outbox.length && cloudMeta.revision > meta.revision) {
      const delta = await remoteDelta(meta.revision);
      meta = await applyDelta(delta, []);
      return result(meta, "synced", 0, { pulled: true, role: delta.role });
    }

    await ensureBaseline(meta);
    const changes = await digestLocalChanges(writableStores);
    const outboxIds = outbox.map((entry) => entry.id);

    if (!changes.length) {
      const delta = await remoteDelta(meta.revision);
      meta = await applyDelta(delta, outboxIds);
      return result(meta, "synced", 0, { pulled: delta.revision > cloudMeta.revision, role: delta.role });
    }

    const mutationId = meta.inFlightMutationId ?? createId("mutation");
    if (!meta.inFlightMutationId) {
      meta = {
        ...meta,
        inFlightMutationId: mutationId,
        inFlightBaseRevision: meta.revision,
        inFlightOutboxIds: outboxIds,
      };
      await saveSyncMeta(meta);
    }

    const started = await postSync<{ status: "pending" | "completed"; revision: number | null }>({
      action: "start",
      mutationId,
      baseRevision: meta.inFlightBaseRevision ?? meta.revision,
      deviceId: meta.deviceId,
      deviceLabel: meta.deviceLabel,
      appVersion: POS_APP_VERSION,
      pendingCount: outbox.length,
    });

    if (started.status !== "completed") {
      for (let offset = 0; offset < changes.length; offset += 75) {
        await postSync({ action: "chunk", mutationId, changes: changes.slice(offset, offset + 75) });
      }
      await postSync({ action: "finalize", mutationId });
    }

    const delta = await remoteDelta(meta.revision);
    meta = await applyDelta(delta, meta.inFlightOutboxIds ?? outboxIds);
    const remaining = await listRecords<OutboxRecord>("outbox");
    return result(meta, remaining.length ? "pending" : "synced", remaining.length, {
      merged: delta.merged,
      role: delta.role,
    });
  } catch (error) {
    outbox = await listRecords<OutboxRecord>("outbox").catch(() => outbox);
    if (error instanceof SyncRequestError && (error.status === 401 || error.status === 403)) {
      return result(meta, "unauthorized", outbox.length, { message: error.message });
    }
    if (error instanceof SyncRequestError && error.status === 409) {
      if (meta.inFlightMutationId) {
        meta = withoutInFlight(meta);
        await saveSyncMeta(meta);
      }
      return result(meta, "conflict", outbox.length, {
        remoteRevision: error.currentRevision,
        message: error.message,
      });
    }
    if (!navigator.onLine || error instanceof TypeError) return result(meta, "offline", outbox.length);
    return result(meta, "error", outbox.length, {
      message: error instanceof Error ? error.message : "SYNC_FAILED",
    });
  }
}

export function syncPosData(): Promise<PosSyncResult> {
  if (activeSync) return activeSync;
  activeSync = withBrowserSyncLock(runSync).finally(() => { activeSync = null; });
  return activeSync;
}

export async function pullCloudOverLocal(): Promise<PosSyncResult> {
  if (activeSync) await activeSync;
  return withBrowserSyncLock(async () => {
    const meta = await getOrCreateSyncMeta();
    const pending = await listRecords<OutboxRecord>("outbox");
    if (!navigator.onLine) return result(meta, "offline", pending.length);
    try {
      const cloud = await remoteState();
      await replaceLocalStateFromCloud(cloud);
      const updated = await getOrCreateSyncMeta();
      return result(updated, "synced", 0, { pulled: true, role: cloud.role });
    } catch (error) {
      if (error instanceof SyncRequestError && (error.status === 401 || error.status === 403)) {
        return result(meta, "unauthorized", pending.length, { message: error.message });
      }
      return result(meta, navigator.onLine ? "error" : "offline", pending.length, {
        message: error instanceof Error ? error.message : "SYNC_PULL_FAILED",
      });
    }
  });
}
