import { NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { ActorContextError } from '@/lib/brain/kernel/errors';
import {
  isIsoDate,
  isTimelineEventType,
  isTimelineSeverity,
  isTimelineSourceType,
  isUuid,
  type TimelineQuery,
} from '@/lib/brain/timeline/contracts';
import { normalizeTimelineError } from '@/lib/brain/timeline/errors';
import { retrieveTimeline } from '@/lib/brain/timeline/retrieval.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie, Authorization',
};

function parseCursor(value: string | null): {
  cursorOccurredAt?: string;
  cursorId?: string;
} | null {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    const cursor = parsed as Record<string, unknown>;
    if (!isIsoDate(cursor.occurredAt) || !isUuid(cursor.id)) return null;
    return { cursorOccurredAt: cursor.occurredAt, cursorId: cursor.id };
  } catch {
    return null;
  }
}

function parseQuery(request: Request): TimelineQuery | null {
  const params = new URL(request.url).searchParams;
  const allowed = new Set([
    'locationId', 'eventType', 'sourceType', 'severity',
    'from', 'to', 'cursor', 'limit',
  ]);
  if ([...params.keys()].some((key) => !allowed.has(key))) return null;
  const locationId = params.get('locationId');
  const eventType = params.get('eventType');
  const sourceType = params.get('sourceType');
  const severity = params.get('severity');
  const from = params.get('from');
  const to = params.get('to');
  const limitText = params.get('limit');
  const limit = limitText === null ? 25 : Number(limitText);
  const cursor = parseCursor(params.get('cursor'));
  if (!cursor
      || locationId !== null && !isUuid(locationId)
      || eventType !== null && !isTimelineEventType(eventType)
      || sourceType !== null && !isTimelineSourceType(sourceType)
      || severity !== null && !isTimelineSeverity(severity)
      || from !== null && !isIsoDate(from)
      || to !== null && !isIsoDate(to)
      || !Number.isInteger(limit) || limit < 1 || limit > 100
      || from && to && Date.parse(from) > Date.parse(to)) return null;
  return {
    ...(locationId ? { locationId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(sourceType ? { sourceType } : {}),
    ...(severity ? { severity } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...cursor,
    limit,
  };
}

export async function GET(request: Request) {
  try {
    const authenticated = await createSupabaseServerAuth();
    const actor = await resolveActorContext(authenticated);
    if (!['manager', 'owner', 'super_admin'].includes(actor.role)) {
      return NextResponse.json({ error: 'BRAIN_TIMELINE_FORBIDDEN' }, {
        status: 403,
        headers: HEADERS,
      });
    }
    const query = parseQuery(request);
    if (!query) return NextResponse.json({ error: 'BRAIN_TIMELINE_INPUT_INVALID' }, {
      status: 400,
      headers: HEADERS,
    });
    const result = await retrieveTimeline(authenticated, actor.companyId, query);
    return NextResponse.json({ data: result }, { headers: HEADERS });
  } catch (error) {
    const code = error instanceof ActorContextError
      ? error.code
      : normalizeTimelineError(error);
    const status = code === 'UNAUTHENTICATED'
      ? 401
      : code === 'BRAIN_TIMELINE_FORBIDDEN'
        || code === 'PROFILE_INACTIVE'
        || code === 'PROFILE_UNASSIGNED'
        ? 403
        : 503;
    return NextResponse.json({ error: code }, { status, headers: HEADERS });
  }
}
