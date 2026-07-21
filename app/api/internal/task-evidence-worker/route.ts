import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { processOneEvidenceVerification } from '@/lib/task-evidence-verification.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

function authorized(request: Request): boolean {
  const secret = process.env.TASK_EVIDENCE_WORKER_SECRET;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || supplied.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  try {
    const result = await processOneEvidenceVerification();
    return NextResponse.json({ result }, { headers: NO_STORE });
  } catch (error) {
    console.error('[Task Evidence Worker] invocation failed', { stage: 'worker.claim', errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : 'unknown_error' });
    return NextResponse.json({ error: 'Evidence processing is temporarily unavailable' }, { status: 503, headers: NO_STORE });
  }
}

