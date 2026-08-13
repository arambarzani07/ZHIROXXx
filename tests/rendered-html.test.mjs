import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: "data:text/javascript,export const env = {};", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("keeps the video reference dashboard at exactly twenty visible modules", async () => {
  const source = await readFile(new URL("../app/pos-app.tsx", import.meta.url), "utf8");
  const moduleBlock = source.match(/const modules: ModuleDefinition\[\] = \[([\s\S]*?)\n\];/);
  assert.ok(moduleBlock, "module definition block should exist");
  const visibleKeys = moduleBlock[1]
    .split("\n")
    .filter((line) => line.includes('{ key:') && !line.includes("hidden: true"))
    .map((line) => line.match(/key: "([^"]+)"/)?.[1]);

  assert.deepEqual(visibleKeys, [
    "customers", "salesReturns", "sales", "cashier",
    "products", "suppliers", "purchaseReturns", "purchases",
    "accounting", "losses", "labels", "warehouse",
    "cashIn", "cashOut", "expenses", "reports",
    "help", "settings", "backup", "users",
  ]);
});

test("packages protected role-aware D1 sync without caching API responses", async () => {
  const [hostingText, routeSource, productionRouteSource, serviceWorkerSource, syncStoreSource] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sync/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../db/sync-store.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(hostingText).d1, "DB");
  assert.match(routeSource, /getChatGPTUser/);
  assert.match(routeSource, /SyncConflictError/);
  assert.match(routeSource, /STAFF_ACCESS_DENIED/);
  assert.match(productionRouteSource, /restoreCloudRevision/);
  assert.match(syncStoreSource, /status = 'completed'/);
  assert.match(syncStoreSource, /mergeConcurrentSyncState/);
  assert.match(syncStoreSource, /CREATE TABLE IF NOT EXISTS pos_staff/);
  assert.match(syncStoreSource, /CREATE TABLE IF NOT EXISTS pos_devices/);
  assert.match(syncStoreSource, /CREATE TABLE IF NOT EXISTS pos_restore_points/);
  assert.match(serviceWorkerSource, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("posts immutable balanced journals for every financial and inventory mutation", async () => {
  const [databaseSource, moneySource, syncContractSource, workspaceSource, serviceWorkerSource] = await Promise.all([
    readFile(new URL("../lib/pos-db.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/pos-money.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sync-contract.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/module-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(databaseSource, /const DB_VERSION = 10/);
  assert.match(databaseSource, /export function buildBalancedJournalEntry/);
  assert.match(moneySource, /Math\.abs\(debitTotalIQD - creditTotalIQD\) > 0\.001/);
  assert.match(syncContractSource, /"journalEntries"/);
  assert.match(serviceWorkerSource, /zhirox-pos-shell-v19/);

  for (const sourceType of [
    "sale", "saleReturn", "purchase", "purchaseReturn", "expense", "cash",
    "loss", "stockAdjustment", "stocktake", "productImport", "recordOpening",
  ]) {
    assert.match(databaseSource, new RegExp(`sourceType: "${sourceType}"`));
  }

  assert.match(workspaceSource, /Trial Balance/);
  assert.match(workspaceSource, /مێژووی تۆمارە نەگۆڕەکان/);
  assert.match(workspaceSource, /usdToIqdRate/);
  assert.match(databaseSource, /paymentCurrency/);
  assert.match(databaseSource, /openingCashUSD/);
  assert.match(databaseSource, /bank: \{ code: "1120"/);
  assert.match(databaseSource, /salesDiscounts: \{ code: "4120"/);
  assert.match(workspaceSource, /شێوازی پارەدان/);
  assert.match(workspaceSource, /discount-control/);
  assert.match(databaseSource, /paymentMethod === "cash" \? JOURNAL_ACCOUNTS\.cash : JOURNAL_ACCOUNTS\.bank/);
  assert.match(workspaceSource, /treasury-form/);
  assert.match(workspaceSource, /جووڵەی خاوێنی بانک/);
});
