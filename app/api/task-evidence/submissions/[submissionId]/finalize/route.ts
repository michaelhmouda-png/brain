import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { isUuid } from '@/lib/task-evidence';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

function row(value: unknown): Record<string, unknown> | null {
  const result = Array.isArray(value) ? value[0] : value;
  return typeof result === 'object' && result !== null && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  const { submissionId } = await context.params;
  if (!isUuid(submissionId)) {
    return NextResponse.json(
      { error: 'Invalid evidence submission identifier' },
      { status: 400, headers: HEADERS },
    );
  }
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: authorization.status, headers: HEADERS },
    );
  }

  const { data, error } = await supabase.rpc('finalize_task_evidence_submission', {
    p_submission_id: submissionId,
  });
  const finalized = row(data);
  if (
    error
    || !finalized
    || typeof finalized.evidence_id !== 'string'
    || !['finalized', 'queued', 'processing'].includes(String(finalized.submission_status))
  ) {
    return NextResponse.json(
      {
        error: 'All photos must be uploaded and verified before submission',
        code: 'EVIDENCE_SUBMISSION_INCOMPLETE',
      },
      { status: 409, headers: HEADERS },
    );
  }

  if (finalized.submission_status === 'finalized') {
    const { data: queuedData, error: queueError } = await supabase.rpc(
      'enqueue_task_evidence_verification',
      { p_evidence_id: finalized.evidence_id },
    );
    const queued = row(queuedData);
    if (queueError || !queued || queued.verification_status !== 'queued') {
      return NextResponse.json(
        {
          error: 'Evidence was saved but analysis could not be queued. Retry finalization.',
          code: 'EVIDENCE_QUEUE_FAILED',
          recoverable: true,
        },
        { status: 503, headers: HEADERS },
      );
    }
  }

  return NextResponse.json(
    {
      submissionId,
      evidenceId: finalized.evidence_id,
      status: 'queued',
    },
    { headers: HEADERS },
  );
}
