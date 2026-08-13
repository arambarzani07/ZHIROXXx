import type { CloudSyncRecord, SyncStoreName } from "@/lib/sync-contract";

export type MergeRecord = Pick<CloudSyncRecord, "storeName" | "recordId" | "payload" | "digest">;

export type ConcurrentMergeResult = {
  records: MergeRecord[];
  conflicts: string[];
};

const additiveFields: Partial<Record<SyncStoreName, string[]>> = {
  products: ["stock"],
  customers: ["balanceIQD"],
  suppliers: ["balanceIQD"],
};

function recordKey(record: Pick<MergeRecord, "storeName" | "recordId">) {
  return `${record.storeName}\u0000${record.recordId}`;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function statusRank(value: unknown) {
  return value === "returned" ? 2 : value === "partial" ? 1 : 0;
}

function mergeChangedPayload(
  storeName: SyncStoreName,
  base: Record<string, unknown>,
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
): { payload?: Record<string, unknown>; conflict?: string } {
  const result: Record<string, unknown> = {};
  const additive = new Set(additiveFields[storeName] ?? []);
  const fields = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);

  for (const field of fields) {
    const baseValue = base[field];
    const localValue = local[field];
    const remoteValue = remote[field];

    if (additive.has(field)) {
      const baseNumber = Number(baseValue ?? 0);
      const localNumber = Number(localValue ?? baseNumber);
      const remoteNumber = Number(remoteValue ?? baseNumber);
      if (![baseNumber, localNumber, remoteNumber].every(Number.isFinite)) {
        return { conflict: `${storeName}:${String(base.id)}:${field}:invalid-number` };
      }
      const merged = baseNumber + (localNumber - baseNumber) + (remoteNumber - baseNumber);
      if (storeName === "products" && field === "stock" && merged < -0.000001) {
        return { conflict: `${storeName}:${String(base.id)}:${field}:negative-stock` };
      }
      result[field] = Math.round(merged * 1_000_000) / 1_000_000;
      continue;
    }

    if (field === "updatedAt") {
      result[field] = [baseValue, localValue, remoteValue]
        .filter((value): value is string => typeof value === "string")
        .sort()
        .at(-1);
      continue;
    }

    if ((storeName === "sales" || storeName === "purchases") && field === "status") {
      result[field] = [baseValue, localValue, remoteValue].sort((left, right) => statusRank(right) - statusRank(left))[0];
      continue;
    }

    if (sameValue(localValue, remoteValue)) result[field] = localValue;
    else if (sameValue(localValue, baseValue)) result[field] = remoteValue;
    else if (sameValue(remoteValue, baseValue)) result[field] = localValue;
    else return { conflict: `${storeName}:${String(base.id)}:${field}:changed-twice` };
  }

  return { payload: result };
}

function recalculateTransactionStatuses(records: MergeRecord[]) {
  const returnsBySource = new Map<string, Map<string, number>>();
  for (const record of records) {
    if (record.storeName !== "saleReturns" && record.storeName !== "purchaseReturns") continue;
    const sourceId = typeof record.payload.sourceId === "string" ? record.payload.sourceId : "";
    if (!sourceId || !Array.isArray(record.payload.items)) continue;
    const quantities = returnsBySource.get(sourceId) ?? new Map<string, number>();
    for (const rawItem of record.payload.items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      if (typeof item.productId !== "string") continue;
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
    }
    returnsBySource.set(sourceId, quantities);
  }

  for (const record of records) {
    if (record.storeName !== "sales" && record.storeName !== "purchases") continue;
    const returned = returnsBySource.get(record.recordId);
    if (!returned?.size) continue;
    const sourceItems = Array.isArray(record.payload.items)
      ? record.payload.items as Array<Record<string, unknown>>
      : [{ productId: record.payload.productId, quantity: record.payload.quantity }];
    const fullyReturned = sourceItems.every((item) =>
      typeof item.productId === "string" && (returned.get(item.productId) ?? 0) >= Number(item.quantity ?? 0) - 0.000001,
    );
    record.payload = { ...record.payload, status: fullyReturned ? "returned" : "partial" };
    record.digest = "";
  }
}

export function mergeConcurrentSyncState(input: {
  base: MergeRecord[];
  local: MergeRecord[];
  remote: MergeRecord[];
  writableStores: SyncStoreName[];
}): ConcurrentMergeResult {
  const base = new Map(input.base.map((record) => [recordKey(record), record]));
  const local = new Map(input.local.map((record) => [recordKey(record), record]));
  const remote = new Map(input.remote.map((record) => [recordKey(record), record]));
  const writable = new Set(input.writableStores);
  const keys = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
  const records: MergeRecord[] = [];
  const conflicts: string[] = [];

  for (const key of keys) {
    const baseRecord = base.get(key);
    const localRecord = local.get(key);
    const remoteRecord = remote.get(key);
    const storeName = (localRecord ?? remoteRecord ?? baseRecord)!.storeName;

    if (!writable.has(storeName)) {
      if (remoteRecord) records.push({ ...remoteRecord, payload: { ...remoteRecord.payload } });
      continue;
    }

    if (!baseRecord) {
      if (localRecord && remoteRecord && localRecord.digest !== remoteRecord.digest) conflicts.push(`${key}:created-twice`);
      else if (localRecord ?? remoteRecord) {
        const selected = localRecord ?? remoteRecord!;
        records.push({ ...selected, payload: { ...selected.payload } });
      }
      continue;
    }

    const localUnchanged = localRecord?.digest === baseRecord.digest;
    const remoteUnchanged = remoteRecord?.digest === baseRecord.digest;
    if (!localRecord && !remoteRecord) continue;
    if (!localRecord) {
      if (remoteUnchanged) continue;
      conflicts.push(`${key}:deleted-locally-changed-remotely`);
      continue;
    }
    if (!remoteRecord) {
      if (localUnchanged) continue;
      conflicts.push(`${key}:changed-locally-deleted-remotely`);
      continue;
    }
    if (localRecord.digest === remoteRecord.digest) {
      records.push({ ...localRecord, payload: { ...localRecord.payload } });
      continue;
    }
    if (localUnchanged) {
      records.push({ ...remoteRecord, payload: { ...remoteRecord.payload } });
      continue;
    }
    if (remoteUnchanged) {
      records.push({ ...localRecord, payload: { ...localRecord.payload } });
      continue;
    }

    const merged = mergeChangedPayload(storeName, baseRecord.payload, localRecord.payload, remoteRecord.payload);
    if (!merged.payload) conflicts.push(merged.conflict ?? `${key}:unmergeable`);
    else records.push({ storeName, recordId: baseRecord.recordId, payload: merged.payload, digest: "" });
  }

  if (!conflicts.length) recalculateTransactionStatuses(records);
  return { records, conflicts };
}

export function validateMergedSyncState(records: MergeRecord[]): string[] {
  const violations: string[] = [];
  const officialReceipts = new Set<string>();
  const sources = new Map<string, Map<string, number>>();
  const returned = new Map<string, Map<string, number>>();

  for (const record of records) {
    if (record.storeName === "products") {
      const stock = Number(record.payload.stock);
      if (!Number.isFinite(stock) || stock < -0.000001) violations.push("SYNC_NEGATIVE_STOCK");
    }
    if ((record.storeName === "sales" || record.storeName === "purchases" || record.storeName === "cashEntries") && typeof record.payload.receiptNo === "string") {
      const receipt = record.payload.receiptNo;
      if (receipt.startsWith("ZX-") && officialReceipts.has(receipt)) violations.push("SYNC_DUPLICATE_RECEIPT");
      if (receipt.startsWith("ZX-")) officialReceipts.add(receipt);
      const items = Array.isArray(record.payload.items)
        ? record.payload.items as Array<Record<string, unknown>>
        : [{ productId: record.payload.productId, quantity: record.payload.quantity }];
      const quantities = new Map<string, number>();
      for (const item of items) {
        if (typeof item.productId === "string") quantities.set(item.productId, Number(item.quantity ?? 0));
      }
      sources.set(`${record.storeName}:${record.recordId}`, quantities);
    }
    if (record.storeName === "journalEntries") {
      const lines = Array.isArray(record.payload.lines) ? record.payload.lines as Array<Record<string, unknown>> : [];
      const debit = lines.reduce((sum, line) => sum + Number(line.debitIQD ?? 0), 0);
      const credit = lines.reduce((sum, line) => sum + Number(line.creditIQD ?? 0), 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || Math.abs(debit - credit) > 0.001) {
        violations.push("SYNC_UNBALANCED_JOURNAL");
      }
    }
    if (record.storeName === "saleReturns" || record.storeName === "purchaseReturns") {
      const sourceId = typeof record.payload.sourceId === "string" ? record.payload.sourceId : "";
      const sourceStore = record.storeName === "saleReturns" ? "sales" : "purchases";
      const key = `${sourceStore}:${sourceId}`;
      const quantities = returned.get(key) ?? new Map<string, number>();
      const items = Array.isArray(record.payload.items) ? record.payload.items as Array<Record<string, unknown>> : [];
      for (const item of items) {
        if (typeof item.productId !== "string") continue;
        quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + Number(item.quantity ?? 0));
      }
      returned.set(key, quantities);
    }
  }

  for (const [sourceKey, quantities] of returned) {
    const available = sources.get(sourceKey);
    if (!available) {
      violations.push("SYNC_RETURN_SOURCE_MISSING");
      continue;
    }
    for (const [productId, quantity] of quantities) {
      if (!Number.isFinite(quantity) || quantity < 0 || quantity - (available.get(productId) ?? 0) > 0.000001) {
        violations.push("SYNC_RETURN_EXCEEDS_SOURCE");
      }
    }
  }
  return [...new Set(violations)];
}
