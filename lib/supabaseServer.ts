import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

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
 * Create an authenticated Supabase client for server components using cookies.
 * Reads the auth session from the 'sb-auth-token' cookie (set by browser client).
 * Use this in server components like app/dashboard/layout.tsx
 * 
 * CRITICAL: Must use the same cookie name as browser client!
 */
export async function createSupabaseServerAuth(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  });

  const cookieStore = await cookies();
  
  // Use the same cookie name as browser client: 'sb-auth-token'
  const authCookie = cookieStore.get('sb-auth-token')?.value;
  
  if (authCookie) {
    try {
      const session = JSON.parse(authCookie);
      if (session?.access_token && session?.refresh_token) {
        await client.auth.setSession(session);
      }
    } catch (e) {
      console.error('[ServerAuth] Failed to parse auth cookie:', e);
    }
  }

  return client;
}
