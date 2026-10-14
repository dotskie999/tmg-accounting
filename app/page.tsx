import { redirect } from "next/navigation";
import CostFlowApp from "./costflow-app";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!getPublicSupabaseConfig()) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const fullName = user.user_metadata?.full_name;
  const displayName = typeof fullName === "string" && fullName.trim()
    ? fullName
    : user.email ?? "TMG Accounting user";

  return (
    <CostFlowApp
      userName={displayName}
      signOutPath="/auth/signout"
    />
  );
}
