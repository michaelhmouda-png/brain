export const COMMAND_ERROR_CODES = [
  'INVALID_COMMAND',
  'INVALID_COMMAND_PAYLOAD',
  'UNSUPPORTED_COMMAND_VERSION',
  'COMMAND_CONTEXT_MISMATCH',
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

export class CommandError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode) {
    super(code);
    this.name = 'CommandError';
    this.code = code;
  }
}
