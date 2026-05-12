"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthFlowMode } from "@/config/authFlow";
import { signInDevEmailOnly } from "@/app/login/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const mode = getAuthFlowMode();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        router.replace("/");
      }
    });
  }, [router]);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err === "auth") {
      setMessage("Sign-in link expired or invalid. Request a new magic link.");
    } else if (err === "config") {
      setMessage("Server configuration error. Check Supabase environment variables.");
    }
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const onMagicLinkSignIn = async () => {
    setLoading(true);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/")}`,
      },
    });
    setLoading(false);
    setMessage(error ? error.message : "Check your email for a magic link.");
  };

  const onEmailPasswordSignUp = async () => {
    setLoading(true);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/")}`,
      },
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(
      "Account created. If email confirmation is enabled in Supabase, check your inbox to verify, then sign in below.",
    );
  };

  const onEmailPasswordSignIn = async () => {
    setLoading(true);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    router.replace("/");
    router.refresh();
  };

  const onDevEmailOnly = async () => {
    setLoading(true);
    setMessage(null);
    const result = await signInDevEmailOnly(email);
    setLoading(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.replace("/");
    router.refresh();
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
      <h1>{mode === "email_password" ? "Account" : "Sign in"}</h1>
      <p className="muted" style={{ margin: 0 }}>
        Auth mode: <code>{mode}</code> — set <code>NEXT_PUBLIC_AUTH_FLOW</code> in{" "}
        <code>.env.local</code> and restart <code>npm run dev</code>.
      </p>

      {mode === "magic_link" ? (
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
            <button onClick={onMagicLinkSignIn} disabled={loading || !email}>
              Send magic link
            </button>
            <button className="secondary" onClick={onSignOut} disabled={loading}>
              Sign out
            </button>
          </div>
          {message ? <p className="muted">{message}</p> : null}
        </div>
      ) : null}

      {mode === "email_password" ? (
        <div className="panel col" style={{ gap: "1.25rem" }}>
          <section className="col" style={{ gap: "0.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Sign up</h2>
            <label htmlFor="su-email">Email</label>
            <input
              id="su-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <label htmlFor="su-password">Password</label>
            <input
              id="su-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password"
              autoComplete="new-password"
            />
            <button onClick={onEmailPasswordSignUp} disabled={loading || !email || !password}>
              Create account
            </button>
          </section>
          <hr style={{ borderColor: "var(--border, #333)", width: "100%" }} />
          <section className="col" style={{ gap: "0.5rem" }}>
            <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Sign in</h2>
            <label htmlFor="si-email">Email</label>
            <input
              id="si-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <label htmlFor="si-password">Password</label>
            <input
              id="si-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              autoComplete="current-password"
            />
            <div className="row">
              <button onClick={onEmailPasswordSignIn} disabled={loading || !email || !password}>
                Sign in
              </button>
              <button className="secondary" onClick={onSignOut} disabled={loading}>
                Sign out
              </button>
            </div>
          </section>
          {message ? <p className="muted">{message}</p> : null}
          <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
            First-time sign-up: if Supabase requires email confirmation, you will get one magic link
            to verify; after that use email + password here. Turn off &quot;Confirm email&quot; in
            Supabase Auth settings for faster local testing.
          </p>
        </div>
      ) : null}

      {mode === "dev_email_only" ? (
        <div className="panel col">
          <p className="muted" style={{ marginTop: 0 }}>
            Dev bypass: no email is sent. Server signs you in with a shared internal password. Requires{" "}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>AUTH_DEV_SHARED_PASSWORD</code>, and{" "}
            <code>AUTH_DEV_EMAIL_BYPASS=1</code>. Do not use in production.
          </p>
          <label htmlFor="dev-email">Email</label>
          <input
            id="dev-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <div className="row">
            <button onClick={onDevEmailOnly} disabled={loading || !email}>
              Continue with email
            </button>
            <button className="secondary" onClick={onSignOut} disabled={loading}>
              Sign out
            </button>
          </div>
          {message ? <p className="muted">{message}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
