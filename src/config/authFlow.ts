/**
 * Switch auth UX without deleting flows. Set at dev/build time via env.
 *
 * - magic_link: Supabase email OTP / magic link (production-style).
 * - email_password: Sign up + sign in with email + password (no magic link button).
 * - dev_email_only: Local/dev only — enter email only; server uses service role +
 *   AUTH_DEV_SHARED_PASSWORD. Requires AUTH_DEV_EMAIL_BYPASS=1 and
 *   SUPABASE_SERVICE_ROLE_KEY. Insecure if misconfigured — never enable in production.
 */
export type AuthFlowMode = "magic_link" | "email_password" | "dev_email_only";

const MODES: AuthFlowMode[] = ["magic_link", "email_password", "dev_email_only"];

export function getAuthFlowMode(): AuthFlowMode {
  const v = process.env.NEXT_PUBLIC_AUTH_FLOW?.trim().toLowerCase();
  if (v && MODES.includes(v as AuthFlowMode)) {
    return v as AuthFlowMode;
  }
  return "magic_link";
}

export function isMagicLinkMode(): boolean {
  return getAuthFlowMode() === "magic_link";
}

export function isEmailPasswordMode(): boolean {
  return getAuthFlowMode() === "email_password";
}

export function isDevEmailOnlyMode(): boolean {
  return getAuthFlowMode() === "dev_email_only";
}

/** Server-side guard: public env alone is not enough for dev bypass. */
export function isDevEmailBypassServerEnabled(): boolean {
  const v = process.env.AUTH_DEV_EMAIL_BYPASS?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}
