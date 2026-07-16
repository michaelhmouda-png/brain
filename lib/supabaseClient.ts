import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

/**
 * Get the singleton Supabase browser client.
 * Uses cookie-based session persistence for middleware compatibility.
 * Do NOT call createClient directly; always use this function.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

  if (!browserClient) {
    console.log('[supabaseClient] Creating singleton browser client');
    browserClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true, // Enable cookie-based session persistence
        storageKey: 'sb-auth-token',
        storage: {
          getItem: (key: string) => {
            if (typeof document === 'undefined') return null;
            const cookies = document.cookie.split('; ');
            const cookie = cookies.find(c => c.startsWith(key + '='));
            const value = cookie ? decodeURIComponent(cookie.split('=')[1]) : null;
            console.log(`[supabaseClient.storage.getItem] key=${key}, found=${!!value}`);
            return value;
          },
          setItem: (key: string, value: string) => {
            if (typeof document === 'undefined') return;
            console.log(`[supabaseClient.storage.setItem] key=${key}, valueLength=${value.length}`);
            document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
          },
          removeItem: (key: string) => {
            if (typeof document === 'undefined') return;
            console.log(`[supabaseClient.storage.removeItem] key=${key}`);
            document.cookie = `${key}=; path=/; max-age=0`;
          },
        },
      },
    });
  }

  return browserClient;
}

/**
 * @deprecated Use getSupabaseBrowserClient() instead
 */
export function createSupabase(): SupabaseClient {
  return getSupabaseBrowserClient();
}
