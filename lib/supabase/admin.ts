import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requirePublicSupabaseConfig } from "./config";

let adminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient() {
  if (adminClient) return adminClient;

  const { url } = requirePublicSupabaseConfig();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY
    ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!secretKey) {
    throw new Error("Supabase server access is not configured. Add SUPABASE_SECRET_KEY.");
  }

  adminClient = createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return adminClient;
}
