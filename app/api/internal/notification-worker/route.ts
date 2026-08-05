import { createSupabaseServer } from '@/lib/supabaseServer';
import { createWorkerHandlers } from '@/lib/internal-worker-response.server';
import { processNotificationWork } from '@/lib/notification-worker.server';
import { runInstrumented } from '@/lib/worker-telemetry.server';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
const handlers=createWorkerHandlers(
  'NOTIFICATION_WORKER_SECRET',
  ()=>{const service=createSupabaseServer();return runInstrumented(service,'notifications',()=>processNotificationWork(service));},
  'Notification delivery temporarily unavailable',
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
);
export const GET=handlers.GET;
export const POST=handlers.POST;
