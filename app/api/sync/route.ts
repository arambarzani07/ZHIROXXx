import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  authorizeStaff,
  finalizeSyncMutation,
  readCloudSyncDelta,
  readCloudSyncMeta,
  readCloudSyncState,
  stageSyncChanges,
  startSyncMutation,
  SyncConflictError,
  SyncMergeConflictError,
} from "@/db/sync-store";
import { SYNC_STORE_NAMES, type CloudSyncChange } from "@/lib/sync-contract";
import { resolveMarketContext } from "@/db/market-store";

export const dynamic = "force-dynamic";

const storeNames = new Set<string>(SYNC_STORE_NAMES);
const noStoreHeaders = { "Cache-Control": "no-store, private" };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStoreHeaders });
}

async function authenticatedActor(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return { status: 401 as const, actor: null };
  const marketId = request.headers.get("x-zhirox-market-id")?.trim();
  if (!marketId) return { status: 400 as const, actor: null };
  const market = await resolveMarketContext({ email: user.email, displayName: user.displayName, marketId });
  if (!market) return { status: 403 as const, actor: null };
  const actor = await authorizeStaff({ ...market, tenantId: market.marketId });
  return actor ? { status: 200 as const, actor } : { status: 403 as const, actor: null };
}

function conflictResponse(error: SyncConflictError) {
  return json({
    error: error.message,
    currentRevision: error.currentRevision,
    conflicts: error instanceof SyncMergeConflictError ? error.conflicts : undefined,
  }, 409);
}

export async function GET(request: Request) {
  let auth;
  try {
    auth = await authenticatedActor(request);
  } catch {
    return json({ error: "AUTHORIZATION_UNAVAILABLE" }, 503);
  }
  if (!auth.actor) return json({ error: auth.status === 401 ? "AUTH_REQUIRED" : auth.status === 400 ? "MARKET_REQUIRED" : "STAFF_ACCESS_DENIED" }, auth.status);
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("mode") === "meta") return json(await readCloudSyncMeta(auth.actor));
    if (params.get("mode") === "delta") {
      const since = Number(params.get("since"));
      if (!Number.isInteger(since) || since < 0) return json({ error: "INVALID_SYNC_REVISION" }, 400);
      return json(await readCloudSyncDelta(auth.actor, since));
    }
    const requested = params.has("revision") ? Number(params.get("revision")) : undefined;
    if (requested !== undefined && (!Number.isInteger(requested) || requested < 0)) {
      return json({ error: "INVALID_SYNC_REVISION" }, 400);
    }
    return json(await readCloudSyncState(auth.actor, requested));
  } catch (error) {
    if (error instanceof SyncConflictError) return conflictResponse(error);
    return json({ error: error instanceof Error ? error.message : "SYNC_READ_FAILED" }, 503);
  }
}

export async function POST(request: Request) {
  let auth;
  try {
    auth = await authenticatedActor(request);
  } catch {
    return json({ error: "AUTHORIZATION_UNAVAILABLE" }, 503);
  }
  if (!auth.actor) return json({ error: auth.status === 401 ? "AUTH_REQUIRED" : auth.status === 400 ? "MARKET_REQUIRED" : "STAFF_ACCESS_DENIED" }, auth.status);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_500_000) return json({ error: "SYNC_PAYLOAD_TOO_LARGE" }, 413);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const action = body.action;
  const mutationId = typeof body.mutationId === "string" ? body.mutationId : "";
  if (!mutationId || mutationId.length > 160) return json({ error: "INVALID_MUTATION_ID" }, 400);

  try {
    if (action === "start") {
      const baseRevision = Number(body.baseRevision);
      const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
      const deviceLabel = typeof body.deviceLabel === "string" ? body.deviceLabel : "کاشێر";
      const appVersion = Number(body.appVersion);
      const pendingCount = Number(body.pendingCount ?? 0);
      if (
        !Number.isInteger(baseRevision) || baseRevision < 0 || !deviceId || deviceId.length > 160 ||
        deviceLabel.length > 120 || !Number.isInteger(appVersion) || appVersion < 1 || appVersion > 10_000 ||
        !Number.isInteger(pendingCount) || pendingCount < 0 || pendingCount > 1_000_000
      ) return json({ error: "INVALID_SYNC_START" }, 400);
      return json(await startSyncMutation({
        mutationId,
        baseRevision,
        deviceId,
        deviceLabel,
        appVersion,
        pendingCount,
        actor: auth.actor,
      }));
    }

    if (action === "chunk") {
      if (!Array.isArray(body.changes) || body.changes.length > 75) return json({ error: "INVALID_SYNC_CHUNK" }, 400);
      const changes: CloudSyncChange[] = [];
      for (const candidate of body.changes) {
        if (!candidate || typeof candidate !== "object") return json({ error: "INVALID_SYNC_CHANGE" }, 400);
        const change = candidate as Record<string, unknown>;
        const upsert = change.operation === "upsert";
        const deletion = change.operation === "delete";
        if (
          (!upsert && !deletion) || typeof change.storeName !== "string" || !storeNames.has(change.storeName) ||
          typeof change.recordId !== "string" || !change.recordId || change.recordId.length > 220 ||
          (upsert && (!change.payload || typeof change.payload !== "object" || Array.isArray(change.payload))) ||
          (deletion && change.payload !== null) ||
          typeof change.digest !== "string" || !/^[a-f0-9]{64}$/.test(change.digest)
        ) return json({ error: "INVALID_SYNC_CHANGE" }, 400);
        changes.push(change as CloudSyncChange);
      }
      return json(await stageSyncChanges(auth.actor, mutationId, changes));
    }

    if (action === "finalize") return json(await finalizeSyncMutation(auth.actor, mutationId));
    return json({ error: "INVALID_SYNC_ACTION" }, 400);
  } catch (error) {
    if (error instanceof SyncConflictError) return conflictResponse(error);
    const message = error instanceof Error ? error.message : "SYNC_WRITE_FAILED";
    if (message.endsWith("_DENIED")) return json({ error: message }, 403);
    if (["SYNC_NEGATIVE_STOCK", "SYNC_DUPLICATE_RECEIPT", "SYNC_UNBALANCED_JOURNAL", "SYNC_RETURN_SOURCE_MISSING", "SYNC_RETURN_EXCEEDS_SOURCE"].includes(message)) {
      return json({ error: message }, 409);
    }
    return json({ error: message }, 503);
  }
}
