"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

let cached: SupabaseClient | null = null;

export function getSupabaseBrowserClient() {
  if (cached) {
    return cached;
  }

  const { supabaseUrl, supabaseAnonKey } = getEnv();
  cached = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return cached;
}
