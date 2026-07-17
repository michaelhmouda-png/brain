import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

/**
 * Get the singleton Supabase browser client.
 * Uses @supabase/ssr createBrowserClient for proper Next.js cookie handling.
 * Session persists automatically via cookies.
 * Do NOT call createBrowserClient directly; always use this function.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variables'
    );
  }

  if (!browserClient) {
    browserClient = createBrowserClient(supabaseUrl, supabasePublishableKey);
  }

  return browserClient;
}

/**
 * @deprecated Use getSupabaseBrowserClient() instead
 */
export function createSupabase(): SupabaseClient {
  return getSupabaseBrowserClient();
}
