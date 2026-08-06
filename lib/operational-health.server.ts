import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServer } from './supabaseServer';
import { normalizeWorkerHealthPayload } from './worker-health-diagnostics';
import { classifyOperationalHealth, type OperationalHealth } from './operational-health';

export async function loadOperationalHealth(service: SupabaseClient = createSupabaseServer()): Promise<OperationalHealth> {
  const envelope = await service.schema('public').rpc('get_system_worker_health_v1', {});
  if (envelope.error) throw new Error('OPERATIONAL_HEALTH_RPC_UNAVAILABLE');
  const payload = normalizeWorkerHealthPayload(envelope.data);
  if (!payload) throw new Error('OPERATIONAL_HEALTH_RESPONSE_INVALID');
  return classifyOperationalHealth(payload);
}
