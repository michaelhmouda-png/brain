import type { CompanyApiRole } from './company-api-authorization';

export const EMPLOYEE_DASHBOARD_PATHS = ['/dashboard', '/dashboard/tasks', '/dashboard/notifications', '/dashboard/shifts', '/dashboard/ai-assistant', '/dashboard/settings'] as const;
export const EMPLOYEE_API_PREFIXES = ['/api/tasks', '/api/notifications', '/api/shifts', '/api/brain/chat', '/api/brain/quota', '/api/task-evidence', '/api/profile/language'] as const;
export const EMPLOYEE_BRAIN_TOOLS = ['get_current_user_profile', 'get_tasks', 'complete_task'] as const;

export function isManagementRole(role: CompanyApiRole): boolean { return role !== 'employee'; }
export function employeeMayOpenDashboardPath(pathname: string): boolean {
  return EMPLOYEE_DASHBOARD_PATHS.some((path) => pathname === path || (path !== '/dashboard' && pathname.startsWith(`${path}/`)));
}
export function employeeMayCallApiPath(pathname: string): boolean {
  if (pathname.includes('/reviews') || pathname.endsWith('/review')) return false;
  return EMPLOYEE_API_PREFIXES.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
export function employeeMayUseBrainTool(name: string): boolean {
  return (EMPLOYEE_BRAIN_TOOLS as readonly string[]).includes(name);
}
