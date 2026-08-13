"use client";

import type { MarketMembership } from "@/lib/market-contract";

export const MARKET_STORAGE_KEY = "zhirox.selectedMarketId";

export function getSelectedMarketId() {
  return typeof window === "undefined" ? "" : window.localStorage.getItem(MARKET_STORAGE_KEY) ?? "";
}

export function setSelectedMarketId(marketId: string) {
  window.localStorage.setItem(MARKET_STORAGE_KEY, marketId);
}

export async function loadMarkets(): Promise<MarketMembership[]> {
  const response = await fetch("/api/markets", { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { markets?: MarketMembership[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "MARKETS_REQUEST_FAILED");
  return payload.markets ?? [];
}
