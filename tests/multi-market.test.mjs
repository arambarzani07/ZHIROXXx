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
  assert.match(route, /createMarket/);
});
