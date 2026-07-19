export const ACTOR_CONTEXT_ERROR_CODES = [
  'UNAUTHENTICATED',
  'ACCOUNT_NOT_PROVISIONED',
  'ACCOUNT_INACTIVE',
  'INVALID_ACTOR_CONTEXT',
  'ACTOR_CONTEXT_UNAVAILABLE',
] as const;

export type ActorContextErrorCode = (typeof ACTOR_CONTEXT_ERROR_CODES)[number];

export class ActorContextError extends Error {
  readonly code: ActorContextErrorCode;

  constructor(code: ActorContextErrorCode) {
    super(code);
    this.name = 'ActorContextError';
    this.code = code;
  }
}

export function actorContextErrorResponse(error: ActorContextError): Response {
  if (error.code === 'UNAUTHENTICATED') {
    return Response.json({ error: 'Unauthorized', code: error.code }, { status: 401 });
  }
  if (error.code === 'ACTOR_CONTEXT_UNAVAILABLE') {
    return Response.json({ error: 'Account validation is temporarily unavailable.', code: error.code }, { status: 503 });
  }
  return Response.json(
    { error: 'This account is not fully provisioned. Contact your administrator.', code: error.code },
    { status: 403 }
  );
}
