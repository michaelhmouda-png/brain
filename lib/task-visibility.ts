import type { CompanyApiAuthorization } from './company-api-authorization';
import type { ActorContext } from './brain/kernel/actor-context';

export type TaskViewer = Pick<Extract<CompanyApiAuthorization, { authorized: true }>, 'role' | 'employeeId'>
  | Pick<ActorContext, 'role' | 'employeeId'>;

export type TaskVisibilityScope =
  | { kind: 'company' }
  | { kind: 'assigned'; employeeId: string }
  | { kind: 'missing_employee_link' };

export type TaskRequestScopeIntent = 'self' | 'company' | 'default';

export function taskRequestUsesSelfScope(message: string): boolean {
  const normalized = message
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return [
    /\bmy (?:assigned )?tasks?\b/,
    /\bmy (?:work|workload|assignments?)\b/,
    /\btasks? (?:that (?:are|were) )?assigned to me\b/,
    /\btasks? for me\b/,
    /\bassigned to me\b/,
    /\bwhat (?:tasks?|work|assignments?) (?:do i have|am i assigned)\b/,
    /\bwhich (?:tasks?|assignments?) (?:do i have|am i assigned)\b/,
    /\bwhat do i (?:need|have) to do\b/,
    /\bwhat am i (?:working on|responsible for)\b/,
    /\bshow me (?:what )?i(?:'m| am) assigned\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function taskRequestUsesCompanyScope(message: string): boolean {
  const normalized = message
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return [
    /\ball (?:(?:pending|open|active|overdue|completed|critical|high priority) )?tasks?\b/,
    /\b(?:company|team|everyone's|everybody's) tasks?\b/,
    /\btasks? (?:for|across) (?:the )?(?:company|team|everyone|everybody)\b/,
    /\bcompany-wide tasks?\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function classifyTaskRequestScope(message: string): TaskRequestScopeIntent {
  // Explicit first-person assignment remains self-scoped even when the caller
  // asks for "all my tasks". Otherwise explicit company wording wins over any
  // stale conversational or model-generated assignee value.
  if (taskRequestUsesSelfScope(message)) return 'self';
  if (taskRequestUsesCompanyScope(message)) return 'company';
  return 'default';
}

export function resolveTaskVisibilityScope(
  viewer: TaskViewer,
  intent: TaskRequestScopeIntent = 'default',
): TaskVisibilityScope {
  if (intent === 'self') {
    return viewer.employeeId
      ? { kind: 'assigned', employeeId: viewer.employeeId }
      : { kind: 'missing_employee_link' };
  }
  if (viewer.role === 'super_admin' || viewer.role === 'owner' || viewer.role === 'manager') {
    return { kind: 'company' };
  }
  return viewer.employeeId
    ? { kind: 'assigned', employeeId: viewer.employeeId }
    : { kind: 'missing_employee_link' };
}

export function shouldApplyModelTaskAssigneeFilter(
  visibility: TaskVisibilityScope,
  intent: TaskRequestScopeIntent,
): boolean {
  return visibility.kind === 'company' && intent !== 'company';
}
