"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const onSignIn = async () => {
    setLoading(true);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      },
    });
    setLoading(false);
    setMessage(error ? error.message : "Check your email for a magic link.");
  };

  const onSignOut = async () => {
    setLoading(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setLoading(false);
    router.refresh();
  };

  return (
    <main className="container col" style={{ gap: "1rem", paddingTop: "2rem" }}>
      <h1>Sign in</h1>
      <div className="panel col">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <div className="row">
          <button onClick={onSignIn} disabled={loading || !email}>
            Send magic link
          </button>
          <button className="secondary" onClick={onSignOut} disabled={loading}>
            Sign out
          </button>
        </div>
        {message ? <p className="muted">{message}</p> : null}
      </div>
    </main>
  );
}
