import LoginForm from "./login-form";
import { getPublicSupabaseConfig } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginForm configured={Boolean(getPublicSupabaseConfig())} />;
}
