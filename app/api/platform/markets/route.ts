import { getChatGPTUser } from "@/app/chatgpt-auth";
import { createPlatformMarket, listPlatformMarkets, requirePlatformOwner, updatePlatformMarket } from "@/db/platform-store";
import { MANAGER_PERMISSIONS } from "@/lib/platform-contract";
import type { ManagerPermission } from "@/lib/production-contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });

async function platformOwner() {
  const user = await getChatGPTUser();
  if (!user) throw new Error("AUTH_REQUIRED");
  return requirePlatformOwner({ email: user.email, displayName: user.displayName });
}

function permissions(value: unknown): ManagerPermission[] {
  return Array.isArray(value) ? value.filter((item): item is ManagerPermission => typeof item === "string" && MANAGER_PERMISSIONS.includes(item as ManagerPermission)) : [];
}

export async function GET() {
  try { await platformOwner(); return json({ markets: await listPlatformMarkets(), permissions: MANAGER_PERMISSIONS }); }
  catch (error) { const message = error instanceof Error ? error.message : "PLATFORM_ACCESS_FAILED"; return json({ error: message }, message === "AUTH_REQUIRED" ? 401 : 403); }
}

export async function POST(request: Request) {
  try {
    const owner = await platformOwner();
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || typeof body.managerEmail !== "string" || typeof body.managerName !== "string") return json({ error: "PLATFORM_MARKET_INPUT_INVALID" }, 400);
    const market = await createPlatformMarket({ ownerActorId: owner.actorId, name: body.name, managerEmail: body.managerEmail, managerName: body.managerName, permissions: permissions(body.permissions) });
    return json({ market }, 201);
  } catch (error) { const message = error instanceof Error ? error.message : "PLATFORM_MARKET_CREATE_FAILED"; return json({ error: message }, message.endsWith("REQUIRED") ? 403 : 400); }
}

export async function PATCH(request: Request) {
  try {
    const owner = await platformOwner();
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.marketId !== "string" || typeof body.managerEmail !== "string" || typeof body.managerName !== "string" || !["trial", "active", "suspended"].includes(String(body.status))) return json({ error: "PLATFORM_MARKET_INPUT_INVALID" }, 400);
    const market = await updatePlatformMarket({ ownerActorId: owner.actorId, marketId: body.marketId, status: body.status as "trial" | "active" | "suspended", managerEmail: body.managerEmail, managerName: body.managerName, permissions: permissions(body.permissions) });
    return json({ market });
  } catch (error) { const message = error instanceof Error ? error.message : "PLATFORM_MARKET_UPDATE_FAILED"; return json({ error: message }, message.endsWith("REQUIRED") ? 403 : 400); }
}
