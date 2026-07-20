export type DomainEventErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_EVENT_PAYLOAD'
  | 'UNSUPPORTED_EVENT_TYPE'
  | 'UNSUPPORTED_EVENT_VERSION'
  | 'EVENT_CONTEXT_MISMATCH'
  | 'EVENT_RECORDING_FAILED';

export class DomainEventError extends Error {
  readonly code: DomainEventErrorCode;

  constructor(code: DomainEventErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = 'DomainEventError';
    this.code = code;
  }
}
