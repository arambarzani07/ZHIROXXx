"use client";

import type { ProductionStatus } from "@/lib/production-contract";
import { getSelectedMarketId } from "@/lib/market-client";

async function productionRequest<T>(init?: RequestInit): Promise<T> {
  const marketId = getSelectedMarketId();
  const response = await fetch("/api/production", {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(marketId ? { "X-Zhirox-Market-Id": marketId } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "PRODUCTION_REQUEST_FAILED");
  return payload as T;
}

export function loadProductionStatus(): Promise<ProductionStatus> {
  return productionRequest<ProductionStatus>();
}

export function restoreProductionRevision(revision: number): Promise<{
  revision: number;
  restoredFromRevision: number;
  changedRecords: number;
}> {
  return productionRequest({
    method: "POST",
    body: JSON.stringify({ action: "restore", revision }),
  });
}
