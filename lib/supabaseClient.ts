import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabase(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

  return createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
    },
  });
}
