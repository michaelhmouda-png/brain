import 'server-only';

import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import { safeEnvironmentDiagnostics } from '@/lib/environment.server';
import { inspectSupabaseServiceConfiguration } from '@/lib/supabase-service-configuration';
import { createSupabaseServer } from '@/lib/supabaseServer';
import {
  configurationDiagnostic,
  normalizeWorkerHealthPayload,
  responseFailureDiagnostic,
  rpcFailureDiagnostic,
  type SafeWorkerTelemetryDiagnostic,
} from '@/lib/worker-health-diagnostics';

function reportTelemetryFailure(diagnostic: SafeWorkerTelemetryDiagnostic) {
  console.warn('[Worker health] telemetry unavailable', diagnostic);
}

export async function getWorkerHealth(actor: ActorContext) {
  if (!['manager', 'owner', 'super_admin'].includes(actor.role)) throw new Error('WORKER_HEALTH_FORBIDDEN');
  const configuration = safeEnvironmentDiagnostics();
  const serviceConfiguration = inspectSupabaseServiceConfiguration();
  if (!serviceConfiguration.usable) {
    const telemetryDiagnostic = configurationDiagnostic(serviceConfiguration);
    reportTelemetryFailure(telemetryDiagnostic);
    return { telemetryAvailable: false, telemetryErrorCode: telemetryDiagnostic.code, telemetryDiagnostic, configuration };
  }
  try {
    const envelope = await createSupabaseServer().schema('public').rpc('get_system_worker_health_v1', {});
    if (envelope.error) {
      const telemetryDiagnostic = rpcFailureDiagnostic(envelope, serviceConfiguration);
      reportTelemetryFailure(telemetryDiagnostic);
      return { telemetryAvailable: false, telemetryErrorCode: telemetryDiagnostic.code, telemetryDiagnostic, configuration };
    }
    const data = normalizeWorkerHealthPayload(envelope.data);
    if (!data) {
      const telemetryDiagnostic = responseFailureDiagnostic(envelope, serviceConfiguration);
      reportTelemetryFailure(telemetryDiagnostic);
      return { telemetryAvailable: false, telemetryErrorCode: telemetryDiagnostic.code, telemetryDiagnostic, configuration };
    }
    return { ...data, telemetryAvailable: true, configuration };
  } catch (error) {
    const envelope = { data: null, error: { code: error instanceof TypeError ? 'FETCH_FAILED' : null }, status: 0 };
    const telemetryDiagnostic = rpcFailureDiagnostic(envelope, serviceConfiguration);
    reportTelemetryFailure(telemetryDiagnostic);
    return { telemetryAvailable: false, telemetryErrorCode: telemetryDiagnostic.code, telemetryDiagnostic, configuration };
  }
}
