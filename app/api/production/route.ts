import { getChatGPTUser } from "@/app/chatgpt-auth";
import { authorizeStaff, readProductionStatus, restoreCloudRevision } from "@/db/sync-store";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, private" };

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: noStoreHeaders });
}

async function authenticatedActor() {
  const user = await getChatGPTUser();
  if (!user) return { status: 401 as const, actor: null };
  const actor = await authorizeStaff({ email: user.email, displayName: user.displayName });
  return actor ? { status: 200 as const, actor } : { status: 403 as const, actor: null };
}

export async function GET() {
  try {
    const auth = await authenticatedActor();
    if (!auth.actor) return json({ error: auth.status === 401 ? "AUTH_REQUIRED" : "STAFF_ACCESS_DENIED" }, auth.status);
    return json(await readProductionStatus(auth.actor));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "PRODUCTION_STATUS_FAILED" }, 503);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await authenticatedActor();
    if (!auth.actor) return json({ error: auth.status === 401 ? "AUTH_REQUIRED" : "STAFF_ACCESS_DENIED" }, auth.status);
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "restore") return json({ error: "INVALID_PRODUCTION_ACTION" }, 400);
    if (auth.actor.role !== "owner") return json({ error: "RESTORE_OWNER_REQUIRED" }, 403);
    const revision = Number(body.revision);
    if (!Number.isInteger(revision) || revision < 0) return json({ error: "RESTORE_REVISION_INVALID" }, 400);
    return json(await restoreCloudRevision(auth.actor, revision));
  } catch (error) {
    const message = error instanceof Error ? error.message : "PRODUCTION_ACTION_FAILED";
    if (message === "RESTORE_OWNER_REQUIRED") return json({ error: message }, 403);
    if (message === "RESTORE_REVISION_INVALID") return json({ error: message }, 400);
    return json({ error: message }, 503);
  }
}
