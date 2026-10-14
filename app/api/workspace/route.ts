import type { User } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadNormalizedWorkspace,
  RevisionConflictError,
  saveNormalizedWorkspace,
} from "@/lib/supabase/workspace-repository";
import {
  applyCommand,
  type WorkspaceCommand,
} from "@/lib/costflow";

export const dynamic = "force-dynamic";

async function authenticatedUser(): Promise<User | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

function actorName(user: User) {
  const fullName = user.user_metadata?.full_name;
  return typeof fullName === "string" && fullName.trim()
    ? fullName.trim()
    : user.email ?? "TMG Accounting user";
}

function serviceErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const missingTable = message.includes("42P01") || message.includes("PGRST202") || message.includes("PGRST205");
  const missingConfiguration = message.includes("Supabase is not configured");
  return Response.json(
    {
      error: missingTable
        ? "The Supabase database is not ready. Run TMG Accounting migrations 002 and 003, then try again."
        : missingConfiguration
          ? "Supabase is not configured. Add the required environment variables, then restart the app."
          : "The workspace service is temporarily unavailable. Please try again.",
    },
    { status: 503 },
  );
}

function commandErrorResponse(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Invalid workspace command." },
    { status: 400 },
  );
}

export async function GET() {
  try {
    const user = await authenticatedUser();
    if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });

    return Response.json(await loadNormalizedWorkspace(getSupabaseAdminClient(), user.id));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await authenticatedUser();
    if (!user) return Response.json({ error: "Sign in is required." }, { status: 401 });

    const rawPayload = await request.text();
    if (rawPayload.length > 64_000) {
      return Response.json({ error: "Workspace commands must be smaller than 64 KB." }, { status: 413 });
    }

    let payload: { revision?: number; command?: WorkspaceCommand };
    try {
      payload = JSON.parse(rawPayload) as { revision?: number; command?: WorkspaceCommand };
    } catch {
      return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
    }
    if (!Number.isInteger(payload.revision) || !payload.command) {
      return Response.json({ error: "Invalid workspace command." }, { status: 400 });
    }

    const revision = payload.revision as number;
    const db = getSupabaseAdminClient();
    const current = await loadNormalizedWorkspace(db, user.id);
    if (current.revision !== revision) {
      return Response.json({ error: "This workspace changed in another session. Refresh and try again.", conflict: true }, { status: 409 });
    }

    let next: ReturnType<typeof applyCommand>;
    try {
      next = applyCommand(current.state, payload.command, actorName(user));
    } catch (error) {
      return commandErrorResponse(error);
    }
    const nextRevision = await saveNormalizedWorkspace(db, user.id, revision, next);
    return Response.json({ state: next, revision: nextRevision });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return Response.json({ error: error.message, conflict: true }, { status: 409 });
    }
    return serviceErrorResponse(error);
  }
}
