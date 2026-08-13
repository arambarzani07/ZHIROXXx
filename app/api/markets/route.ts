import { getChatGPTUser } from "@/app/chatgpt-auth";
import { listActorMarkets } from "@/db/market-store";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "AUTH_REQUIRED" }, { status: 401, headers });
  return Response.json({ markets: await listActorMarkets({ email: user.email, displayName: user.displayName }) }, { headers });
}

export async function POST(request: Request) {
  void request;
  return Response.json({ error: "PLATFORM_OWNER_REQUIRED" }, { status: 403, headers });
}
