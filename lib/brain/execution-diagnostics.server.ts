interface ExecutionDiagnosticContext {
  readonly proposalId: string;
  readonly correlationId: string;
  readonly action: string;
  readonly stage: string;
}

export function logApprovedExecutionFailure(
  context: ExecutionDiagnosticContext,
  error: unknown,
): void {
  let original = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
  const seen = new Set<unknown>();
  while (original?.cause && typeof original.cause === 'object' && !seen.has(original.cause)) {
    seen.add(original);
    original = original.cause as Record<string, unknown>;
  }
  console.error('[Brain Chat] Approved execution diagnostic', {
    ...context,
    operation: original?.operation ?? context.stage,
    originalException: original ?? error,
    message: original?.message ?? String(error),
    code: original?.code ?? null,
    details: original?.details ?? null,
    hint: original?.hint ?? null,
    stack: original?.stack ?? null,
  });
}
