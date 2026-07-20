import type { CompanyApiAuthorization } from './company-api-authorization';
import type { ActorContext } from './brain/kernel/actor-context';

export type TaskViewer = Pick<Extract<CompanyApiAuthorization, { authorized: true }>, 'role' | 'employeeId'>
  | Pick<ActorContext, 'role' | 'employeeId'>;

export type TaskVisibilityScope =
  | { kind: 'company' }
  | { kind: 'assigned'; employeeId: string }
  | { kind: 'missing_employee_link' };

export function resolveTaskVisibilityScope(viewer: TaskViewer): TaskVisibilityScope {
  if (viewer.role === 'super_admin' || viewer.role === 'owner' || viewer.role === 'manager') {
    return { kind: 'company' };
  }
  return viewer.employeeId
    ? { kind: 'assigned', employeeId: viewer.employeeId }
    : { kind: 'missing_employee_link' };
}
