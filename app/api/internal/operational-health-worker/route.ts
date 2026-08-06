import { createWorkerHandlers } from '@/lib/internal-worker-response.server';
import { loadOperationalHealth } from '@/lib/operational-health.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const handlers = createWorkerHandlers(
  'NOTIFICATION_WORKER_SECRET',
  async () => {
    const health = await loadOperationalHealth();
    if (health.status !== 'ok') throw new Error('OPERATIONAL_HEALTH_DEGRADED');
    return { status: health.status, observedAt: health.observedAt };
  },
  'Operational health evaluation temporarily unavailable',
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
);

export const GET = handlers.GET;
export const POST = handlers.POST;
