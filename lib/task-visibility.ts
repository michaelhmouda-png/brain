import type { CompanyApiAuthorization } from './company-api-authorization';
import type { ActorContext } from './brain/kernel/actor-context';

export type TaskViewer = Pick<Extract<CompanyApiAuthorization, { authorized: true }>, 'role' | 'employeeId'>
  | Pick<ActorContext, 'role' | 'employeeId'>;

export type TaskVisibilityScope =
  | { kind: 'company' }
  | { kind: 'assigned'; employeeId: string }
  | { kind: 'missing_employee_link' };

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

export function resolveTaskVisibilityScope(
  viewer: TaskViewer,
  trustedSelfReference = false,
): TaskVisibilityScope {
  if (trustedSelfReference) {
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
