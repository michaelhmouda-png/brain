import { createWorkerHandlers } from '@/lib/internal-worker-response.server';
import { processRecurringTaskWork } from '@/lib/recurring-tasks/service.server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { runInstrumented } from '@/lib/worker-telemetry.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const handlers = createWorkerHandlers(
  () => process.env.NOTIFICATION_WORKER_SECRET,
  () => { const service = createSupabaseServer(); return runInstrumented(service, 'recurring_tasks', () => processRecurringTaskWork(service)); },
  'Recurring task materialization temporarily unavailable',
);
export const GET = handlers.GET;
export const POST = handlers.POST;
