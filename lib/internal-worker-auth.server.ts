import 'server-only';

import { timingSafeEqual } from 'node:crypto';

function bearer(request: Request): string {
  return request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
}

function matches(candidate: string, expected: string | undefined): boolean {
  if (!expected || !candidate || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

export function authorizeCronRequest(request: Request): boolean {
  return request.method === 'GET' && matches(bearer(request), process.env.CRON_SECRET);
}

export function authorizeManualWorkerRequest(request: Request, secret: string | undefined): boolean {
  return request.method === 'POST' && matches(bearer(request), secret);
}
