const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;

export function safeRuntimeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message.split(':', 1)[0] : '';
  return SAFE_CODE.test(candidate) ? candidate : 'SERVER_REQUEST_FAILED';
}

export type SafeRequestErrorDiagnostic = {
  stage: 'request';
  code: string;
  method: string;
  routeType: string;
  routerKind: string;
};

export function safeRequestErrorDiagnostic(
  error: unknown,
  request: { method?: unknown },
  context: { routeType?: unknown; routerKind?: unknown },
): SafeRequestErrorDiagnostic {
  const method = typeof request.method === 'string' && /^[A-Z]{3,10}$/.test(request.method)
    ? request.method
    : 'UNKNOWN';
  const routeType = typeof context.routeType === 'string' && /^[a-z-]{1,24}$/.test(context.routeType)
    ? context.routeType
    : 'unknown';
  const routerKind = context.routerKind === 'App Router' || context.routerKind === 'Pages Router'
    ? context.routerKind
    : 'unknown';
  return { stage: 'request', code: safeRuntimeErrorCode(error), method, routeType, routerKind };
}
