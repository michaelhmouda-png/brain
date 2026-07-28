import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { isRecord } from '@/lib/client-api';
import {
  parsePrepareTaskEvidenceSubmission,
  type TaskEvidenceSubmissionItemInput,
} from '@/lib/task-evidence-submission';
import { TASK_EVIDENCE_BUCKET } from '@/lib/task-evidence';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

type PreparedItem = TaskEvidenceSubmissionItemInput & {
  storagePath: string;
  status: 'pending_upload' | 'upload_failed' | 'verified';
};

function preparedItems(value: unknown): PreparedItem[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map((item) => {
    if (
      !isRecord(item)
      || typeof item.itemId !== 'string'
      || typeof item.ordinal !== 'number'
      || (item.sourceType !== 'mobile_camera' && item.sourceType !== 'gallery_upload')
      || typeof item.storagePath !== 'string'
      || typeof item.mimeType !== 'string'
      || typeof item.sizeBytes !== 'number'
      || typeof item.sha256 !== 'string'
      || !['pending_upload', 'upload_failed', 'verified'].includes(String(item.status))
    ) {
      return null;
    }
    return {
      itemId: item.itemId,
      ordinal: item.ordinal,
      sourceType: item.sourceType,
      storagePath: item.storagePath,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      sha256: item.sha256,
      status: item.status,
    } as PreparedItem;
  });
  return parsed.some((item) => item === null) ? null : parsed as PreparedItem[];
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) {
    return NextResponse.json(
      { error: authorization.status === 401 ? 'Unauthorized' : 'Account is not provisioned' },
      { status: authorization.status, headers: HEADERS },
    );
  }

  const input = parsePrepareTaskEvidenceSubmission(
    await request.json().catch(() => null),
  );
  if (!input) {
    return NextResponse.json(
      { error: 'Invalid evidence submission', code: 'EVIDENCE_SUBMISSION_INVALID' },
      { status: 400, headers: HEADERS },
    );
  }

  const { data, error } = await supabase.rpc('prepare_task_evidence_submission', {
    p_task_id: input.taskId,
    p_location_id: input.locationId,
    p_source_type: input.sourceType,
    p_items: input.items,
    p_submitted_count: input.count,
    p_idempotency_key: input.idempotencyKey,
  });
  const row = Array.isArray(data) ? data[0] : data;
  const items = isRecord(row) ? preparedItems(row.items) : null;
  if (
    error
    || !isRecord(row)
    || typeof row.submission_id !== 'string'
    || typeof row.evidence_id !== 'string'
    || typeof row.submission_status !== 'string'
    || !items
  ) {
    console.error('[Task Evidence C5] prepare failed', {
      stage: 'submission.prepare',
      code: error?.code ?? 'SUBMISSION_PREPARE_FAILED',
    });
    return NextResponse.json(
      { error: 'Evidence submission is temporarily unavailable' },
      { status: 503, headers: HEADERS },
    );
  }

  const uploads = [];
  for (const item of items) {
    if (item.status === 'verified') {
      uploads.push({ ...item, upload: null });
      continue;
    }
    const { data: signed, error: signingError } = await supabase.storage
      .from(TASK_EVIDENCE_BUCKET)
      .createSignedUploadUrl(item.storagePath, { upsert: false });
    if (signingError || !signed?.token) {
      await supabase.rpc('fail_task_evidence_submission_item', {
        p_submission_id: row.submission_id,
        p_item_id: item.itemId,
      });
      return NextResponse.json(
        {
          error: 'Evidence upload is temporarily unavailable',
          code: 'EVIDENCE_SIGNING_FAILED',
          failedItemId: item.itemId,
        },
        { status: 503, headers: HEADERS },
      );
    }
    uploads.push({
      ...item,
      upload: {
        bucket: TASK_EVIDENCE_BUCKET,
        path: item.storagePath,
        token: signed.token,
      },
    });
  }

  return NextResponse.json(
    {
      submissionId: row.submission_id,
      evidenceId: row.evidence_id,
      status: row.submission_status,
      duplicate: row.is_duplicate === true,
      items: uploads,
    },
    { status: row.is_duplicate === true ? 200 : 201, headers: HEADERS },
  );
}
