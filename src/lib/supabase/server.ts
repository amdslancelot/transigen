import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getEnv } from "@/lib/env";

export async function getSupabaseServerClient() {
  const store = await cookies();
  const { supabaseUrl, supabaseAnonKey } = getEnv();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          store.set(name, value, options);
        });
      },
    },
  });
}
