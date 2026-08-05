import 'server-only';

import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { safeEnvironmentDiagnostics } from '@/lib/environment.server';
import { createSupabaseServer } from '@/lib/supabaseServer';

export async function getWorkerHealth(actor: ActorContext) {
  if (!['manager', 'owner', 'super_admin'].includes(actor.role)) throw new Error('WORKER_HEALTH_FORBIDDEN');
  const configuration = safeEnvironmentDiagnostics();
  try {
    const { data, error } = await createSupabaseServer().rpc('get_system_worker_health_v1');
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      return { telemetryAvailable: false, telemetryErrorCode: 'WORKER_TELEMETRY_UNAVAILABLE', configuration };
    }
    return { ...data, telemetryAvailable: true, configuration };
  } catch {
    return { telemetryAvailable: false, telemetryErrorCode: 'WORKER_TELEMETRY_UNAVAILABLE', configuration };
  }
}
