import 'server-only';

import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { normalizeLanguage, type Language } from '@/lib/i18n';

/**
 * Root-document locale authority. Authenticated UI language comes only from the
 * persisted profile; request parameters, cookies, browser settings and storage
 * are deliberately not consulted.
 */
export async function loadPersistedProfileLanguage(): Promise<Language> {
  try {
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return 'en';
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('preferred_language')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError || !profile) return 'en';
    return normalizeLanguage(profile.preferred_language);
  } catch {
    return 'en';
  }
}
