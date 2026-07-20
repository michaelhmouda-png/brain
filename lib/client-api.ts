export type RouteDiagnostic = {
  route: string;
  stage: 'fetch' | 'response' | 'parse' | 'validate';
  status?: number;
  contentType?: string;
  errorName: string;
  errorMessage: string;
};

export class ClientApiError extends Error {
  readonly diagnostic: RouteDiagnostic;

  constructor(
    message: string,
    diagnostic: RouteDiagnostic
  ) {
    super(message);
    this.name = 'ClientApiError';
    this.diagnostic = diagnostic;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : '';
}

function collectionFromPayload(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) return payload;
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data;
  return null;
}

export async function fetchJsonCollection(
  route: string,
  input: string,
  signal: AbortSignal
): Promise<unknown[]> {
  let response: Response;
  try {
    response = await fetch(input, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    const aborted = signal.aborted;
    throw new ClientApiError(
      aborted ? 'The request timed out. Please try again.' : 'Unable to reach the server. Please try again.',
      {
        route,
        stage: 'fetch',
        errorName: error instanceof Error ? error.name : 'FetchError',
        errorMessage: aborted ? 'request_aborted' : 'request_failed',
      }
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new ClientApiError('The server returned an invalid response. Please try again.', {
      route,
      stage: 'response',
      status: response.status,
      contentType: contentType || 'missing',
      errorName: 'InvalidContentType',
      errorMessage: 'expected_application_json',
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ClientApiError('The server returned unreadable data. Please try again.', {
      route,
      stage: 'parse',
      status: response.status,
      contentType,
      errorName: error instanceof Error ? error.name : 'JsonParseError',
      errorMessage: 'invalid_json',
    });
  }

  if (!response.ok) {
    const unauthorized = response.status === 401;
    throw new ClientApiError(
      unauthorized ? 'Your session has expired. Please sign in again.' : 'This data is temporarily unavailable.',
      {
        route,
        stage: 'response',
        status: response.status,
        contentType,
        errorName: 'HttpError',
        errorMessage: `http_${response.status}`,
      }
    );
  }

  const collection = collectionFromPayload(payload);
  if (!collection) {
    throw new ClientApiError('The server returned an unexpected data format.', {
      route,
      stage: 'validate',
      status: response.status,
      contentType,
      errorName: 'InvalidCollectionShape',
      errorMessage: 'expected_array_or_paginated_data',
    });
  }

  return collection;
}

export function logRouteDiagnostic(route: string, error: unknown): void {
  const diagnostic: RouteDiagnostic = error instanceof ClientApiError
    ? error.diagnostic
    : {
        route,
        stage: 'validate',
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: 'unexpected_client_error',
      };

  console.error(`[${route}] Route data load failed`, diagnostic);
}

export function userFacingRouteError(error: unknown): string {
  return error instanceof ClientApiError
    ? error.message
    : 'This page could not load its data. Please try again.';
}
