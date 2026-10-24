"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!configured) return;
    setBusy(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
        router.refresh();
        return;
      }

      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${siteUrl.replace(/\/$/, "")}/auth/callback`,
        },
      });
      if (error) throw error;
      if (data.session) {
        router.replace("/");
        router.refresh();
      }
      else setMessage("Check your email to confirm the account, then sign in.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><div className="brand-logo" role="img" aria-label="TMG Accounting" /><div><strong>TMG Accounting</strong><small>Simple food costing</small></div></div>
        <div className="auth-lock"><LockKeyhole size={21} /></div>
        <p className="eyebrow">Private business workspace</p>
        <h1>{mode === "signin" ? "Welcome back" : "Create your workspace"}</h1>
        <p className="auth-copy">Sign in to manage ingredients, preparations, menu costs, and selling prices.</p>

        {!configured && <div className="auth-setup"><strong>Supabase setup required</strong><span>Add the variables from .env.example before signing in.</span></div>}

        <form onSubmit={submit}>
          {mode === "signup" && <label className="field"><span>Full name</span><input required autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>}
          <label className="field"><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="field"><span>Password</span><input required minLength={8} type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="button primary auth-submit" disabled={!configured || busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}<ArrowRight size={17} /></button>
        </form>

        <button className="auth-switch" type="button" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
          {mode === "signin" ? "New to TMG Accounting? Create an account" : "Already have an account? Sign in"}
        </button>
      </section>
    </main>
  );
}
