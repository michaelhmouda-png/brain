import { NextResponse } from 'next/server';
import { previewTrustedAddressEvidence } from '@/lib/brain-agent/security.server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    return NextResponse.json(previewTrustedAddressEvidence(request, request.headers.get('x-phase2a-acceptance-proof')), { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ error: 'NOT_AVAILABLE' }, { status: 404, headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  }
}
