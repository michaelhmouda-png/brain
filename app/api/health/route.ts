import { NextResponse } from 'next/server';
import { loadOperationalHealth } from '@/lib/operational-health.server';
import { safeRuntimeErrorCode } from '@/lib/safe-runtime-observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'public, no-store, max-age=0' };

export async function GET() {
  try {
    const health = await loadOperationalHealth();
    return NextResponse.json(
      { status: health.status, code: health.status === 'ok' ? 'BRAIN_HEALTHY' : 'BRAIN_DEGRADED', checkedAt: health.observedAt },
      { status: health.status === 'ok' ? 200 : 503, headers: HEADERS },
    );
  } catch (error) {
    console.warn('[Public health] unavailable', { stage: 'operational_health', code: safeRuntimeErrorCode(error) });
    return NextResponse.json(
      { status: 'degraded', code: 'BRAIN_HEALTH_UNAVAILABLE' },
      { status: 503, headers: HEADERS },
    );
  }
}
