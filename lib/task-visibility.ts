import type { CompanyApiAuthorization } from './company-api-authorization';
import type { ActorContext } from './brain/kernel/actor-context';

export type TaskViewer = Pick<Extract<CompanyApiAuthorization, { authorized: true }>, 'role' | 'employeeId'>
  | Pick<ActorContext, 'role' | 'employeeId'>;

export type TaskVisibilityScope =
  | { kind: 'company' }
  | { kind: 'assigned'; employeeId: string }
  | { kind: 'missing_employee_link' };

export type TaskRequestScopeIntent = 'self' | 'company' | 'default';

export type CompanyTaskEmployee = {
  id: string;
  firstName: string;
  lastName: string;
};

export type CompanyTaskEmployeeResolution =
  | { kind: 'matched'; employee: CompanyTaskEmployee }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' };

export type NamedTaskFilterKind = 'title' | 'status' | 'priority' | 'due_date';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTaskIntentText(message: string): string {
  return message
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function taskRequestUsesSelfScope(message: string): boolean {
  const normalized = normalizeTaskIntentText(message);
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
  const normalized = normalizeTaskIntentText(message);
  return [
    /\ball (?:(?:pending|open|active|overdue|completed|critical|high priority) )?tasks?\b/,
    /\b(?:company|team|everyone's|everybody's) tasks?\b/,
    /\btasks? (?:for|across) (?:the )?(?:company|team|everyone|everybody)\b/,
    /\bcompany-wide tasks?\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function taskRequestNeedsUnfilteredCompanyTasks(message: string): boolean {
  const normalized = normalizeTaskIntentText(message);
  const withoutAnyStatus = normalized.replace(/\b(?:of )?any status\b/g, '');
  const hasNarrowing = /\b(?:pending|open|active|overdue|completed|critical|high priority|due|today|tomorrow|assigned to)\b/
    .test(withoutAnyStatus);
  return !hasNarrowing && (
    /\ball tasks?\b/.test(withoutAnyStatus) ||
    /\b(?:company|team) tasks?\b/.test(withoutAnyStatus)
  );
}

export function classifyTaskRequestScope(message: string): TaskRequestScopeIntent {
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

export function resolveTaskResultLimit(modelLimit: unknown, unfilteredCompanyRequest: boolean): number {
  if (unfilteredCompanyRequest) return 100;
  if (typeof modelLimit !== 'number' || !Number.isFinite(modelLimit)) return 20;
  return Math.max(1, Math.min(Math.trunc(modelLimit), 100));
}

export function taskRequestExplicitlyIncludesFilter(message: string, filter: NamedTaskFilterKind): boolean {
  const normalized = normalizeTaskIntentText(message);
  switch (filter) {
    case 'status':
      return /\b(?:pending|in progress|completed)\b/.test(normalized);
    case 'priority':
      return /\b(?:low|medium|high|critical)(?: priority)?\b/.test(normalized);
    case 'due_date':
      return /\b(?:due|today|tomorrow|overdue)\b/.test(normalized) ||
        /\b\d{4}-\d{2}-\d{2}\b/.test(normalized);
    case 'title':
      return /\b(?:titled|called|named|with (?:the )?title|containing)\b/.test(normalized);
  }
}

function normalizeEmployeeLookupName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019']s\b/gi, '')
    .replace(/[\u2018\u2019']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function resolveCompanyTaskEmployee(
  rows: readonly Record<string, unknown>[],
  requestedName: string,
): CompanyTaskEmployeeResolution {
  const search = normalizeEmployeeLookupName(requestedName);
  if (!search) return { kind: 'not_found' };

  const employees = rows.flatMap((row): CompanyTaskEmployee[] => {
    if (!UUID_PATTERN.test(String(row.id ?? '')) || typeof row.first_name !== 'string') return [];
    return [{
      id: String(row.id),
      firstName: row.first_name,
      lastName: typeof row.last_name === 'string' ? row.last_name : '',
    }];
  });
  const exact = employees.filter((employee) =>
    normalizeEmployeeLookupName(`${employee.firstName} ${employee.lastName}`) === search);
  const matches = exact.length > 0 ? exact : employees.filter((employee) => {
    const fullName = normalizeEmployeeLookupName(`${employee.firstName} ${employee.lastName}`);
    return fullName.split(' ').includes(search) || fullName.includes(search);
  });

  if (matches.length === 0) return { kind: 'not_found' };
  if (matches.length > 1) return { kind: 'ambiguous' };
  return { kind: 'matched', employee: matches[0] };
}

export function taskRequestReferencesCompanyEmployee(
  message: string,
  employee: CompanyTaskEmployee,
): boolean {
  const normalizedMessage = ` ${normalizeEmployeeLookupName(message)} `;
  const firstName = normalizeEmployeeLookupName(employee.firstName);
  const fullName = normalizeEmployeeLookupName(`${employee.firstName} ${employee.lastName}`);
  return Boolean(fullName && normalizedMessage.includes(` ${fullName} `)) ||
    Boolean(firstName && normalizedMessage.includes(` ${firstName} `));
}
