import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Create an admin Supabase client using service role key.
 * Use ONLY for admin operations that bypass RLS.
 * NEVER use with user data unless explicitly needed.
 */
export function createSupabaseServer(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL for server-side Supabase operations.");
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}

/**
 * Create an authenticated Supabase client for server components.
 * Uses @supabase/ssr for proper Next.js SSR cookie handling.
 * Reads cookies from the current request and forwards authenticated session.
 * 
 * Use this in server components and functions that need to query data as the authenticated user.
 * Example: app/dashboard/locations/page.tsx
 */
export async function createSupabaseServerAuth(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Cookie setting can fail in some contexts (e.g., after headers sent)
          // This is expected in server components that only read
        }
      },
    },
  });
}
