import { NextRequest, NextResponse } from 'next/server';
import { authorizeCompanyApiRequestFromSupabase } from '@/lib/company-api-authorization.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { parsePrepareTaskEvidence, TASK_EVIDENCE_BUCKET } from '@/lib/task-evidence';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Vary: 'Cookie, Authorization' };

function rpcRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return typeof row === 'object' && row !== null && !Array.isArray(row) ? row as Record<string, unknown> : null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerAuth();
    const authorization = await authorizeCompanyApiRequestFromSupabase(supabase);
    if (!authorization.authorized) {
      return NextResponse.json({ error: authorization.status === 401 ? 'Unauthorized' : 'Account is not provisioned' }, { status: authorization.status, headers: NO_STORE_HEADERS });
    }

    let raw: unknown;
    try { raw = await request.json(); } catch { raw = null; }
    const input = parsePrepareTaskEvidence(raw);
    if (!input) return NextResponse.json({ error: 'Invalid evidence request' }, { status: 400, headers: NO_STORE_HEADERS });

    const { data: profile, error: profileError } = await supabase.from('profiles').select('employee_id').eq('id', authorization.profileId).maybeSingle();
    if (profileError || !profile) return NextResponse.json({ error: 'Account is not provisioned' }, { status: 403, headers: NO_STORE_HEADERS });
    const { data: task, error: taskError } = await supabase.from('tasks').select('id, assigned_employee_id, status').eq('id', input.taskId).eq('company_id', authorization.companyId).maybeSingle();
    if (taskError || !task) return NextResponse.json({ error: 'Task is not available' }, { status: 404, headers: NO_STORE_HEADERS });
    if (task.status !== 'pending' && task.status !== 'in_progress') return NextResponse.json({ error: 'Task is not active' }, { status: 409, headers: NO_STORE_HEADERS });
    if (authorization.role === 'employee' && (typeof profile.employee_id !== 'string' || task.assigned_employee_id !== profile.employee_id)) {
      return NextResponse.json({ error: 'Task is not assigned to this employee' }, { status: 403, headers: NO_STORE_HEADERS });
    }
    if (input.locationId) {
      const { data: location, error } = await supabase.from('locations').select('id').eq('id', input.locationId).eq('company_id', authorization.companyId).maybeSingle();
      if (error || !location) return NextResponse.json({ error: 'Location is not available' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const { data, error } = await supabase.rpc('prepare_task_evidence_upload', {
      p_task_id: input.taskId,
      p_location_id: input.locationId,
      p_source_type: input.sourceType,
      p_original_mime_type: input.mimeType,
      p_original_size_bytes: input.sizeBytes,
      p_original_sha256: input.sha256,
      p_idempotency_key: input.idempotencyKey,
    });
    const prepared = rpcRow(data);
    if (error || !prepared || typeof prepared.evidence_id !== 'string' || typeof prepared.storage_path !== 'string' || typeof prepared.upload_status !== 'string') {
      return NextResponse.json({ error: 'Evidence upload is temporarily unavailable' }, { status: 503, headers: NO_STORE_HEADERS });
    }
    if (prepared.upload_status === 'pending_review') {
      return NextResponse.json({ evidenceId: prepared.evidence_id, status: 'pending_review', duplicate: true }, { headers: NO_STORE_HEADERS });
    }

    if (prepared.is_duplicate === true) {
      const { data: objectExists, error: existsError } = await supabase.storage.from(TASK_EVIDENCE_BUCKET).exists(prepared.storage_path);
      if (!existsError && objectExists) {
        return NextResponse.json({ evidenceId: prepared.evidence_id, status: 'uploaded_pending_completion', duplicate: true }, { headers: NO_STORE_HEADERS });
      }
    }

    const { data: signed, error: signingError } = await supabase.storage.from(TASK_EVIDENCE_BUCKET).createSignedUploadUrl(prepared.storage_path, { upsert: false });
    if (signingError || !signed?.token) {
      await supabase.rpc('fail_task_evidence_upload', { p_evidence_id: prepared.evidence_id });
      return NextResponse.json({ error: 'Evidence upload is temporarily unavailable' }, { status: 503, headers: NO_STORE_HEADERS });
    }
    return NextResponse.json({
      evidenceId: prepared.evidence_id,
      status: prepared.upload_status,
      duplicate: prepared.is_duplicate === true,
      upload: { bucket: TASK_EVIDENCE_BUCKET, path: prepared.storage_path, token: signed.token },
    }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error('[Task Evidence API] prepare failed', { stage: 'evidence.prepare', errorName: error instanceof Error ? error.name : 'UnknownError', errorMessage: error instanceof Error ? error.message : 'unknown_error' });
    return NextResponse.json({ error: 'Evidence upload is temporarily unavailable' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
