import 'server-only';

import { NextResponse } from 'next/server';
import { authorizeCronRequest, authorizeManualWorkerRequest } from './internal-worker-auth.server';
import { safeWorkerFailureCode } from './worker-telemetry.server';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export function createWorkerHandlers(
  manualSecret: () => string | undefined,
  run: () => Promise<unknown>,
  unavailableMessage: string,
) {
  async function execute() {
    try {
      return NextResponse.json({ result: await run() }, { headers: NO_STORE });
    } catch (error) {
      console.error('[Internal worker] failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: safeWorkerFailureCode(error),
      });
      return NextResponse.json({ error: unavailableMessage }, { status: 503, headers: NO_STORE });
    }
  }
  return {
    async GET(request: Request) {
      if (!authorizeCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
      return execute();
    },
    async POST(request: Request) {
      if (!authorizeManualWorkerRequest(request, manualSecret())) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
      }
      return execute();
    },
  };
}
