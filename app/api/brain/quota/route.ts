import { NextResponse } from 'next/server';
import { getBrainChatQuotaStatus } from '@/lib/brain/chat-quota.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

export async function GET() {
  try {
    const supabase = await createSupabaseServerAuth();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS });
    }
    const quota = await getBrainChatQuotaStatus(supabase);
    return NextResponse.json({ quota }, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: 'AI request quota is temporarily unavailable.', code: 'BRAIN_CHAT_QUOTA_UNAVAILABLE' },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
