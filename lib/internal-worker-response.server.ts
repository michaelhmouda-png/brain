import 'server-only';

import { NextResponse } from 'next/server';
import {
  authorizeCronRequest,
  authorizeNamedManualWorkerRequest,
  isWorkerAuthenticationConfigured,
  type ManualWorkerSecretName,
} from './internal-worker-auth.server';
import { hasEnvironmentIssues } from './environment.server';
import { safeWorkerFailureCode } from './worker-telemetry.server';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export function createWorkerHandlers(
  manualSecretName: ManualWorkerSecretName,
  run: () => Promise<unknown>,
  unavailableMessage: string,
  requiredConfiguration: readonly string[] = [],
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
      if (!isWorkerAuthenticationConfigured('CRON_SECRET')) {
        return NextResponse.json({ error: 'Worker unavailable', code: 'WORKER_CONFIGURATION_UNAVAILABLE' }, { status: 503, headers: NO_STORE });
      }
      if (!authorizeCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
      if (hasEnvironmentIssues(requiredConfiguration)) {
        return NextResponse.json({ error: 'Worker unavailable', code: 'WORKER_CONFIGURATION_UNAVAILABLE' }, { status: 503, headers: NO_STORE });
      }
      return execute();
    },
    async POST(request: Request) {
      if (!isWorkerAuthenticationConfigured(manualSecretName)) {
        return NextResponse.json({ error: 'Worker unavailable', code: 'WORKER_CONFIGURATION_UNAVAILABLE' }, { status: 503, headers: NO_STORE });
      }
      if (!authorizeNamedManualWorkerRequest(request, manualSecretName)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
      }
      if (hasEnvironmentIssues(requiredConfiguration)) {
        return NextResponse.json({ error: 'Worker unavailable', code: 'WORKER_CONFIGURATION_UNAVAILABLE' }, { status: 503, headers: NO_STORE });
      }
      return execute();
    },
  };
}
