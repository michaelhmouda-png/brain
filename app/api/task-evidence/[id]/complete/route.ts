import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { isUuid, sniffTaskEvidenceMime, TASK_EVIDENCE_BUCKET, TASK_EVIDENCE_MAX_BYTES } from '@/lib/task-evidence';

export const dynamic = 'force-dynamic';
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return typeof row === 'object' && row !== null && !Array.isArray(row) ? row as Record<string, unknown> : null;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid evidence identifier' }, { status: 400, headers: NO_STORE_HEADERS });
  const supabase = await createSupabaseServerAuth();
  const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
  if (!authorization.authorized) return NextResponse.json({ error: 'Unauthorized' }, { status: authorization.status, headers: NO_STORE_HEADERS });

  try {
    const { data, error } = await supabase.rpc('get_task_evidence_upload', { p_evidence_id: id });
    const evidence = firstRow(data);
    if (error || !evidence || typeof evidence.storage_path !== 'string' || typeof evidence.expected_mime_type !== 'string' || typeof evidence.expected_size_bytes !== 'number') {
      return NextResponse.json({ error: 'Evidence is not available' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (evidence.upload_status === 'pending_review') return NextResponse.json({ evidenceId: id, status: 'pending_review' }, { headers: NO_STORE_HEADERS });

    const { data: object, error: downloadError } = await supabase.storage.from(TASK_EVIDENCE_BUCKET).download(evidence.storage_path);
    if (downloadError || !object || object.size !== evidence.expected_size_bytes || object.size > TASK_EVIDENCE_MAX_BYTES) throw new Error('EVIDENCE_OBJECT_INVALID');
    const bytes = new Uint8Array(await object.arrayBuffer());
    const detectedMime = sniffTaskEvidenceMime(bytes);
    if (!detectedMime || detectedMime !== evidence.expected_mime_type) throw new Error('EVIDENCE_CONTENT_TYPE_MISMATCH');
    const sha256 = createHash('sha256').update(bytes).digest('hex');

    const { data: completedData, error: completionError } = await supabase.rpc('complete_task_evidence_upload', { p_evidence_id: id, p_verified_sha256: sha256 });
    const completed = firstRow(completedData);
    if (completionError || !completed) throw new Error('EVIDENCE_FINALIZE_FAILED');
    return NextResponse.json({ evidenceId: id, taskId: completed.task_id, status: completed.evidence_status }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    await supabase.rpc('fail_task_evidence_upload', { p_evidence_id: id });
    console.error('[Task Evidence API] completion failed', { stage: 'evidence.complete', evidenceId: id, errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : 'unknown_error' });
    return NextResponse.json({ error: 'Evidence verification failed. Please retry the upload.' }, { status: 422, headers: NO_STORE_HEADERS });
  }
}
