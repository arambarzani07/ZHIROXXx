import type { PosRole } from "@/lib/production-contract";

export type MarketStatus = "trial" | "active" | "suspended";

export type MarketMembership = {
  marketId: string;
  marketName: string;
  marketSlug: string;
  status: MarketStatus;
  role: PosRole;
  active: boolean;
};

export type MarketContext = MarketMembership & {
  actorId: string;
  email: string;
  displayName: string;
};
