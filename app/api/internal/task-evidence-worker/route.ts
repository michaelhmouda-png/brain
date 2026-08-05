import { createWorkerHandlers } from '@/lib/internal-worker-response.server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { processOneEvidenceVerification } from '@/lib/task-evidence-verification.server';
import { runInstrumented } from '@/lib/worker-telemetry.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const handlers = createWorkerHandlers(
  'TASK_EVIDENCE_WORKER_SECRET',
  () => { const service = createSupabaseServer(); return runInstrumented(service, 'evidence', () => processOneEvidenceVerification(service)); },
  'Evidence processing is temporarily unavailable',
  ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'OPENAI_VISION_MODEL'],
);
export const GET = handlers.GET;
export const POST = handlers.POST;

