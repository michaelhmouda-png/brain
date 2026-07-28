import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import {
  isUuid,
  sniffTaskEvidenceMime,
  TASK_EVIDENCE_BUCKET,
  TASK_EVIDENCE_MAX_BYTES,
} from '@/lib/task-evidence';
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
  context: { params: Promise<{ submissionId: string; itemId: string }> },
) {
  const { submissionId, itemId } = await context.params;
  if (!isUuid(submissionId) || !isUuid(itemId)) {
    return NextResponse.json(
      { error: 'Invalid evidence item identifier' },
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

  const { data, error } = await supabase.rpc('get_task_evidence_submission_upload', {
    p_submission_id: submissionId,
  });
  const item = Array.isArray(data)
    ? data.map(row).find((candidate) => candidate?.item_id === itemId) ?? null
    : null;
  if (
    error
    || !item
    || typeof item.storage_path !== 'string'
    || typeof item.expected_mime_type !== 'string'
    || typeof item.expected_size_bytes !== 'number'
    || typeof item.expected_sha256 !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Evidence item is not available' },
      { status: 404, headers: HEADERS },
    );
  }
  if (item.item_status === 'verified') {
    return NextResponse.json(
      { submissionId, itemId, status: 'verified', duplicate: true },
      { headers: HEADERS },
    );
  }

  try {
    const { data: object, error: downloadError } = await supabase.storage
      .from(TASK_EVIDENCE_BUCKET)
      .download(item.storage_path);
    if (
      downloadError
      || !object
      || object.size !== item.expected_size_bytes
      || object.size > TASK_EVIDENCE_MAX_BYTES
    ) {
      throw new Error('EVIDENCE_ITEM_SIZE_MISMATCH');
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const detectedMime = sniffTaskEvidenceMime(bytes);
    if (!detectedMime || detectedMime !== item.expected_mime_type) {
      throw new Error('EVIDENCE_ITEM_MIME_MISMATCH');
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== item.expected_sha256) throw new Error('EVIDENCE_ITEM_HASH_MISMATCH');

    const { data: completion, error: completionError } = await supabase.rpc(
      'complete_task_evidence_submission_item',
      {
        p_submission_id: submissionId,
        p_item_id: itemId,
        p_verified_sha256: hash,
      },
    );
    const completed = row(completion);
    if (completionError || !completed || completed.item_status !== 'verified') {
      throw new Error('EVIDENCE_ITEM_FINALIZE_FAILED');
    }
    return NextResponse.json(
      { submissionId, itemId, status: 'verified' },
      { headers: HEADERS },
    );
  } catch (completionError) {
    await supabase.rpc('fail_task_evidence_submission_item', {
      p_submission_id: submissionId,
      p_item_id: itemId,
    });
    const code = completionError instanceof Error
      ? completionError.message
      : 'EVIDENCE_ITEM_VERIFICATION_FAILED';
    console.error('[Task Evidence C5] item completion failed', {
      stage: 'submission.item.complete',
      submissionId,
      itemId,
      code,
    });
    return NextResponse.json(
      {
        error: 'This photo could not be verified. Retry this photo.',
        code,
        failedItemId: itemId,
      },
      { status: 422, headers: HEADERS },
    );
  }
}
