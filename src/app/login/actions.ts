"use server";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isDevEmailBypassServerEnabled, isDevEmailOnlyMode } from "@/config/authFlow";
import { getEnv } from "@/lib/env";

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  let page = 1;
  const maxPages = 25;
  while (page <= maxPages) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

function looksLikeUserAlreadyExists(message: string | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("already") ||
    m.includes("registered") ||
    m.includes("exists") ||
    m.includes("duplicate")
  );
}

/**
 * Dev-only: ensures user exists with a known password, then signs in and sets session cookies.
 */
export async function signInDevEmailOnly(
  email: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isDevEmailOnlyMode() || !isDevEmailBypassServerEnabled()) {
    return { ok: false, message: "Dev email-only sign-in is not enabled." };
  }

  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) {
    return { ok: false, message: "Enter a valid email." };
  }

  const { supabaseUrl, supabaseAnonKey } = getEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sharedPassword = process.env.AUTH_DEV_SHARED_PASSWORD;

  if (!serviceKey || !sharedPassword) {
    return {
      ok: false,
      message: "Set SUPABASE_SERVICE_ROLE_KEY and AUTH_DEV_SHARED_PASSWORD on the server.",
    };
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: createError } = await admin.auth.admin.createUser({
    email: trimmed,
    password: sharedPassword,
    email_confirm: true,
  });

  if (createError) {
    if (!looksLikeUserAlreadyExists(createError.message)) {
      return { ok: false, message: createError.message };
    }
    const userId = await findUserIdByEmail(admin, trimmed);
    if (!userId) {
      return { ok: false, message: "User exists but could not be loaded. Try again." };
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password: sharedPassword,
      email_confirm: true,
    });
    if (updErr) {
      return { ok: false, message: updErr.message };
    }
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      },
    },
  });

  const { error: signErr } = await supabase.auth.signInWithPassword({
    email: trimmed,
    password: sharedPassword,
  });

  if (signErr) {
    return { ok: false, message: signErr.message };
  }

  return { ok: true };
}
