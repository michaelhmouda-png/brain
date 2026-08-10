import type { Instrumentation } from 'next';
import { safeRequestErrorDiagnostic } from './lib/safe-runtime-observability';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { EnvironmentConfigurationError, validateServerEnvironment } = await import('./lib/environment.server');
    try {
      validateServerEnvironment();
    } catch (error) {
      if (error instanceof EnvironmentConfigurationError) {
        console.error('[Brain configuration] startup rejected', error.toJSON());
      }
      throw error;
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error('[Brain request] failed', safeRequestErrorDiagnostic(error, request, context));
};
