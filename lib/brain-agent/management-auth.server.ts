import 'server-only';
import { NextResponse } from 'next/server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' };
export function agentManagementActorFailure(error: unknown, fallbackCode: string): NextResponse {
  if (error instanceof ActorContextError) {
    const status = error.code === 'UNAUTHENTICATED' ? 401 : error.code === 'ACTOR_CONTEXT_UNAVAILABLE' ? 503 : 403;
    return NextResponse.json({ error: status === 401 ? 'AGENT_UNAUTHENTICATED' : status === 403 ? 'AGENT_FORBIDDEN' : 'AGENT_UNAVAILABLE' }, { status, headers: HEADERS });
  }
  return NextResponse.json({ error: fallbackCode }, { status: 503, headers: HEADERS });
}
