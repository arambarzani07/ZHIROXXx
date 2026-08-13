import assert from "node:assert/strict";
import test from "node:test";

import { buildOfficialReceiptNo } from "../lib/pos-id.ts";
import { mergeConcurrentSyncState, validateMergedSyncState } from "../lib/pos-sync-merge.ts";
import { readStoresForRole, writeStoresForRole } from "../lib/production-contract.ts";

function record(storeName, recordId, payload, digest) {
  return { storeName, recordId, payload: { id: recordId, ...payload }, digest };
}

test("merges simultaneous sales additively without losing stock or immutable transactions", () => {
  const base = [record("products", "p1", { name: "ئاوی مەعدەنی", stock: 10 }, "base-product")];
  const local = [
    record("products", "p1", { name: "ئاوی مەعدەنی", stock: 8 }, "local-product"),
    record("sales", "sale-a", { receiptNo: "ZX-F-A", totalIQD: 2_000, status: "completed" }, "sale-a"),
  ];
  const remote = [
    record("products", "p1", { name: "ئاوی مەعدەنی", stock: 7 }, "remote-product"),
    record("sales", "sale-b", { receiptNo: "ZX-F-B", totalIQD: 3_000, status: "completed" }, "sale-b"),
  ];

  const merged = mergeConcurrentSyncState({ base, local, remote, writableStores: ["products", "sales"] });
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.records.find((item) => item.recordId === "p1")?.payload.stock, 5);
  assert.deepEqual(
    merged.records.filter((item) => item.storeName === "sales").map((item) => item.recordId).sort(),
    ["sale-a", "sale-b"],
  );
});

test("blocks concurrent overselling instead of creating negative inventory", () => {
  const base = [record("products", "p1", { stock: 5 }, "base")];
  const local = [record("products", "p1", { stock: 0 }, "local")];
  const remote = [record("products", "p1", { stock: 0 }, "remote")];
  const merged = mergeConcurrentSyncState({ base, local, remote, writableStores: ["products"] });
  assert.equal(merged.records.length, 0);
  assert.match(merged.conflicts[0], /negative-stock/);
});

test("blocks two devices from returning more than the original sale", () => {
  const records = [
    record("sales", "sale-1", { receiptNo: "ZX-F-20260812-A1B2-001001", items: [{ productId: "p1", quantity: 2 }] }, "sale"),
    record("saleReturns", "return-a", { sourceId: "sale-1", items: [{ productId: "p1", quantity: 2 }] }, "return-a"),
    record("saleReturns", "return-b", { sourceId: "sale-1", items: [{ productId: "p1", quantity: 1 }] }, "return-b"),
  ];
  assert.ok(validateMergedSyncState(records).includes("SYNC_RETURN_EXCEEDS_SOURCE"));
});

test("keeps official receipt numbers deterministic and terminal-specific", () => {
  const date = new Date("2026-08-12T10:00:00Z");
  assert.equal(buildOfficialReceiptNo({ prefix: "F", terminalCode: "A1B2", sequence: 1001, date }), "ZX-F-20260812-A1B2-001001");
  assert.notEqual(
    buildOfficialReceiptNo({ prefix: "F", terminalCode: "A1B2", sequence: 1001, date }),
    buildOfficialReceiptNo({ prefix: "F", terminalCode: "C3D4", sequence: 1001, date }),
  );
});

test("enforces server store permissions by staff role", () => {
  assert.ok(writeStoresForRole("cashier").includes("sales"));
  assert.ok(writeStoresForRole("cashier").includes("products"));
  assert.ok(!writeStoresForRole("cashier").includes("purchases"));
  assert.ok(readStoresForRole("accountant").includes("journalEntries"));
  assert.equal(writeStoresForRole("owner").length, 17);
});

test("merges twenty thousand records while retaining every record", () => {
  const base = [];
  const local = [];
  const remote = [];
  for (let index = 0; index < 20_000; index += 1) {
    const id = `product-${index}`;
    const original = record("products", id, { name: id, stock: 100 }, `base-${index}`);
    base.push(original);
    local.push(index < 250 ? record("products", id, { name: id, stock: 99 }, `local-${index}`) : original);
    remote.push(index >= 250 && index < 500 ? record("products", id, { name: id, stock: 98 }, `remote-${index}`) : original);
  }
  const merged = mergeConcurrentSyncState({ base, local, remote, writableStores: ["products"] });
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.records.length, 20_000);
  assert.equal(merged.records.find((item) => item.recordId === "product-10")?.payload.stock, 99);
  assert.equal(merged.records.find((item) => item.recordId === "product-300")?.payload.stock, 98);
});
