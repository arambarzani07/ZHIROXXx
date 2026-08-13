import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("packages the multi-market tenancy foundation with server-side membership guards", async () => {
  const [schema, store, route] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/market-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/markets/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /posMarketMemberships/);
  assert.match(schema, /marketId/);
  assert.match(store, /resolveMarketContext/);
  assert.match(store, /mm\.market_id = \? AND mm\.actor_id = \?/);
  assert.match(store, /row\.status === "suspended"/);
  assert.match(route, /getChatGPTUser/);
  assert.match(route, /PLATFORM_OWNER_REQUIRED/);
});

test("scopes cloud sync and production requests to the selected market", async () => {
  const [syncStore, syncRoute, productionRoute, client] = await Promise.all([
    readFile(new URL("../db/sync-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pos-sync.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(syncStore, /const TENANT_ID = "main-market"/);
  assert.match(syncStore, /actor\.tenantId/);
  assert.match(syncRoute, /x-zhirox-market-id/);
  assert.match(productionRoute, /x-zhirox-market-id/);
  assert.match(client, /X-Zhirox-Market-Id/);
});

test("reserves market creation and manager permissions for the platform owner", async () => {
  const [platformStore, platformRoute, platformPage, syncStore] = await Promise.all([
    readFile(new URL("../db/platform-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/markets/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/platform/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/sync-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(platformStore, /requirePlatformOwner/);
  assert.match(platformStore, /pos_platform_owners/);
  assert.match(platformStore, /role, active, created_at, updated_at/);
  assert.match(platformStore, /'manager'/);
  assert.match(platformRoute, /createPlatformMarket/);
  assert.match(platformRoute, /updatePlatformMarket/);
  assert.match(platformPage, /دەسەڵاتەکانی بەڕێوەبەر/);
  assert.match(syncStore, /pos_manager_permissions/);
  assert.match(syncStore, /writeStoresForActor/);
});
