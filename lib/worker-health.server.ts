import 'server-only';

import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function getWorkerHealth(actor: ActorContext) {
  if (!['manager', 'owner', 'super_admin'].includes(actor.role)) throw new Error('WORKER_HEALTH_FORBIDDEN');
  const { data, error } = await createSupabaseServer().rpc('get_system_worker_health_v1');
  if (error || !data || typeof data !== 'object') throw new Error('WORKER_HEALTH_UNAVAILABLE');
  return data;
}
