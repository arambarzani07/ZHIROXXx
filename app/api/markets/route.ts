import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createMarket, listActorMarkets } from "@/db/market-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
  return Response.json({ markets: await listActorMarkets({ email: user.email, displayName: user.displayName }) }, { headers });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || typeof body.name !== "string") return Response.json({ error: "MARKET_NAME_INVALID" }, { status: 400, headers });
  try {
    const market = await createMarket({ email: user.email, displayName: user.displayName, name: body.name });
    return Response.json({ market }, { status: 201, headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "MARKET_CREATE_FAILED" }, { status: 400, headers });
  }
}
