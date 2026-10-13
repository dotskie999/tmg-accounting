import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { workspaces } from "@/db/schema";
import { applyCommand, createSeedState, type WorkspaceCommand, type WorkspaceState } from "@/lib/costflow";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

async function loadOrCreateWorkspace(userId: string) {
  const db = getDb();
  let [row] = await db.select().from(workspaces).where(eq(workspaces.userId, userId)).limit(1);
  if (!row) {
    await db.insert(workspaces).values({ userId, stateJson: JSON.stringify(createSeedState()), revision: 1 }).onConflictDoNothing();
    [row] = await db.select().from(workspaces).where(eq(workspaces.userId, userId)).limit(1);
  }
  if (!row) throw new Error("Unable to initialize the workspace.");
  return row;
}

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const missingTable = message.includes("no such table");
  return Response.json({ error: missingTable ? "The database is still being prepared. Please try again shortly." : message }, { status: missingTable ? 503 : status });
}

export async function GET() {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
    const row = await loadOrCreateWorkspace(user.userId);
    return Response.json({ state: JSON.parse(row.stateJson) as WorkspaceState, revision: row.revision });
  } catch (error) { return errorResponse(error, 500); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });
    const payload = (await request.json()) as { revision?: number; command?: WorkspaceCommand };
    if (!Number.isInteger(payload.revision) || !payload.command) return Response.json({ error: "Invalid workspace command." }, { status: 400 });
    const db = getDb();
    const row = await loadOrCreateWorkspace(user.userId);
    if (row.revision !== payload.revision) return Response.json({ error: "This workspace changed in another session. Refresh and try again.", conflict: true }, { status: 409 });
    const next = applyCommand(JSON.parse(row.stateJson) as WorkspaceState, payload.command, user.displayName);
    const updated = await db.update(workspaces).set({ stateJson: JSON.stringify(next), revision: sql`${workspaces.revision} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(workspaces.userId, user.userId), eq(workspaces.revision, payload.revision))).returning({ revision: workspaces.revision });
    if (!updated.length) return Response.json({ error: "This workspace changed in another session. Refresh and try again.", conflict: true }, { status: 409 });
    return Response.json({ state: next, revision: updated[0].revision });
  } catch (error) { return errorResponse(error); }
}
