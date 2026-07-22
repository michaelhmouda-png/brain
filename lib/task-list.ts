export type TaskListItem = {
  id: string;
  title: string;
  description: string | null;
  displayTitle: string | null;
  displayDescription: string | null;
  translationState: 'not_required' | 'ready' | 'pending' | 'failed';
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  dueDate: string | null;
  dueAt: string | null;
  companyTimezone: string | null;
  location: { id: string; name: string } | null;
  assignedEmployee: {
    id: string;
    firstName: string;
    lastName: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type QueryResult = {
  data: unknown;
  error: { message?: string } | null;
};

export interface TaskListAccess {
  listTasks(companyId: string, assignedEmployeeId: string | null): Promise<QueryResult>;
  listEmployees(companyId: string, employeeIds: string[]): Promise<QueryResult>;
}

const PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !value) throw new Error('INVALID_TASK_LIST_DATA');
  return value;
}

function optionalString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error('INVALID_TASK_LIST_DATA');
  return value;
}

export async function loadCompanyTasks(
  access: TaskListAccess,
  companyId: string,
  assignedEmployeeId: string | null = null,
  companyTimezone: string | null = null,
): Promise<TaskListItem[]> {
  const taskResult = await access.listTasks(companyId, assignedEmployeeId);
  if (taskResult.error || !Array.isArray(taskResult.data)) throw new Error('TASK_LIST_QUERY_FAILED');

  const taskRows = taskResult.data.map((value) => {
    const row = record(value);
    if (!row) throw new Error('INVALID_TASK_LIST_DATA');
    return row;
  });
  const employeeIds = [...new Set(taskRows
    .map((row) => optionalString(row, 'assigned_employee_id'))
    .filter((id): id is string => id !== null))];

  const employeeById = new Map<string, { id: string; firstName: string; lastName: string | null }>();
  if (employeeIds.length > 0) {
    const employeeResult = await access.listEmployees(companyId, employeeIds);
    if (employeeResult.error || !Array.isArray(employeeResult.data)) throw new Error('TASK_ASSIGNEE_QUERY_FAILED');
    for (const value of employeeResult.data) {
      const row = record(value);
      if (!row) throw new Error('INVALID_TASK_ASSIGNEE_DATA');
      const id = requiredString(row, 'id');
      employeeById.set(id, {
        id,
        firstName: requiredString(row, 'first_name'),
        lastName: optionalString(row, 'last_name'),
      });
    }
  }

  return taskRows.map((row) => {
    const priority = requiredString(row, 'priority');
    const status = requiredString(row, 'status');
    if (!PRIORITIES.has(priority) || !STATUSES.has(status)) throw new Error('INVALID_TASK_LIST_DATA');
    const employeeId = optionalString(row, 'assigned_employee_id');
    const rawLocation = Array.isArray(row.location) ? row.location[0] : row.location;
    const location = record(rawLocation);
    return {
      id: requiredString(row, 'id'),
      title: requiredString(row, 'title'),
      description: optionalString(row, 'description'),
      displayTitle: requiredString(row, 'title'),
      displayDescription: optionalString(row, 'description'),
      translationState: 'not_required',
      priority: priority as TaskListItem['priority'],
      status: status as TaskListItem['status'],
      dueDate: optionalString(row, 'due_date'),
      dueAt: optionalString(row, 'due_at'),
      companyTimezone,
      location: location ? { id: requiredString(location, 'id'), name: requiredString(location, 'name') } : null,
      assignedEmployee: employeeId ? employeeById.get(employeeId) ?? null : null,
      createdAt: requiredString(row, 'created_at'),
      updatedAt: requiredString(row, 'updated_at'),
    };
  });
}
