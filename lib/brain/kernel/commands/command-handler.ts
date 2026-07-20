import type { CommandEnvelope } from './command-envelope.ts';

export interface CommandHandler<
  TCommand extends CommandEnvelope<string, unknown>,
  TResult,
> {
  execute(command: TCommand): Promise<TResult>;
}
