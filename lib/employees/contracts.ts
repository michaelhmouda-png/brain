export const EMPLOYEE_MANAGEMENT_ROLES = ['manager', 'owner', 'super_admin'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMPLOYMENT_TYPES = ['full-time', 'part-time', 'contract', 'temporary'] as const;
const STATUSES = ['active', 'inactive', 'terminated'] as const;

export const employeeSaveMessages = {
  en: {
    EMPLOYEE_INPUT_INVALID: 'Review the employee details and try again.',
    EMPLOYEE_FORBIDDEN: 'You are not authorized to manage employees.',
    EMPLOYEE_DEPARTMENT_REQUIRED: 'Choose an active department.',
    EMPLOYEE_DEPARTMENT_INVALID: 'Choose an active department in your company.',
    EMPLOYEE_LOCATION_INVALID: 'Choose an active location in your company.',
    EMPLOYEE_NOT_FOUND: 'The employee is no longer available.',
    EMPLOYEE_ARCHIVED: 'Archived employees cannot be edited.',
    EMPLOYEE_SAVE_UNAVAILABLE: 'The employee could not be saved. Please try again.',
    UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
    ACCOUNT_NOT_PROVISIONED: 'Your account is not authorized for this workspace.',
    ACCOUNT_INACTIVE: 'Your account is inactive.',
    ACTOR_CONTEXT_UNAVAILABLE: 'Account validation is temporarily unavailable.',
  },
  ar: {
    EMPLOYEE_INPUT_INVALID: 'راجع بيانات الموظف وحاول مرة أخرى.',
    EMPLOYEE_FORBIDDEN: 'ليس لديك صلاحية لإدارة الموظفين.',
    EMPLOYEE_DEPARTMENT_REQUIRED: 'اختر قسماً نشطاً.',
    EMPLOYEE_DEPARTMENT_INVALID: 'اختر قسماً نشطاً تابعاً لشركتك.',
    EMPLOYEE_LOCATION_INVALID: 'اختر موقعاً نشطاً تابعاً لشركتك.',
    EMPLOYEE_NOT_FOUND: 'لم يعد سجل الموظف متاحاً.',
    EMPLOYEE_ARCHIVED: 'لا يمكن تعديل الموظفين المؤرشفين.',
    EMPLOYEE_SAVE_UNAVAILABLE: 'تعذر حفظ الموظف. حاول مرة أخرى.',
    UNAUTHENTICATED: 'انتهت جلستك. سجّل الدخول مرة أخرى.',
    ACCOUNT_NOT_PROVISIONED: 'حسابك غير مخوّل لاستخدام مساحة العمل هذه.',
    ACCOUNT_INACTIVE: 'حسابك غير نشط.',
    ACTOR_CONTEXT_UNAVAILABLE: 'التحقق من الحساب غير متاح مؤقتاً.',
  },
} as const;

export type EmployeeSaveErrorCode = keyof typeof employeeSaveMessages.en;

const SAFE_EMPLOYEE_ERRORS: readonly EmployeeSaveErrorCode[] = [
  'EMPLOYEE_INPUT_INVALID',
  'EMPLOYEE_FORBIDDEN',
  'EMPLOYEE_DEPARTMENT_REQUIRED',
  'EMPLOYEE_DEPARTMENT_INVALID',
  'EMPLOYEE_LOCATION_INVALID',
  'EMPLOYEE_NOT_FOUND',
  'EMPLOYEE_ARCHIVED',
];

export function normalizeEmployeeMutationError(error: unknown): EmployeeSaveErrorCode {
  const message = error instanceof Error ? error.message : '';
  return SAFE_EMPLOYEE_ERRORS.find((code) => message.includes(code)) ?? 'EMPLOYEE_SAVE_UNAVAILABLE';
}

export type EmployeeMutationInput = {
  locationId: string | null;
  departmentId: string;
  firstName: string;
  lastName: string;
  role: string;
  phone: string | null;
  email: string | null;
  employmentType: (typeof EMPLOYMENT_TYPES)[number];
  salary: number;
  hireDate: string | null;
  status: (typeof STATUSES)[number];
  notes: string | null;
};

export function canManageEmployees(role: string) {
  return EMPLOYEE_MANAGEMENT_ROLES.includes(role as (typeof EMPLOYEE_MANAGEMENT_ROLES)[number]);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('EMPLOYEE_INPUT_INVALID');
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('EMPLOYEE_INPUT_INVALID');
    return null;
  }
  if (typeof value !== 'string') throw new Error('EMPLOYEE_INPUT_INVALID');
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error('EMPLOYEE_INPUT_INVALID');
  return result;
}

function uuid(value: unknown, code: EmployeeSaveErrorCode, required = false) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error(code);
    return null;
  }
  const result = text(value, 36);
  if (result === null) return null;
  if (!UUID.test(result)) throw new Error(code);
  return result;
}

export function parseEmployeeMutation(value: unknown): EmployeeMutationInput {
  const row = object(value);
  const departmentId = uuid(row.department_id, 'EMPLOYEE_DEPARTMENT_REQUIRED', true);
  if (!departmentId) throw new Error('EMPLOYEE_DEPARTMENT_REQUIRED');
  const locationId = uuid(row.location_id, 'EMPLOYEE_LOCATION_INVALID');
  const employmentType = row.employment_type ?? 'full-time';
  const status = row.status ?? 'active';
  const salary = Number(row.salary ?? 0);
  const hireDate = text(row.hire_date, 10);
  const email = text(row.email, 254);
  if (!EMPLOYMENT_TYPES.includes(employmentType as never)
    || !STATUSES.includes(status as never)
    || !Number.isFinite(salary) || salary < 0
    || hireDate !== null && !DATE.test(hireDate)
    || email !== null && !/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('EMPLOYEE_INPUT_INVALID');
  }
  return {
    locationId,
    departmentId,
    firstName: text(row.first_name, 120, true)!,
    lastName: text(row.last_name, 120, true)!,
    role: text(row.role, 120, true)!,
    phone: text(row.phone, 40),
    email,
    employmentType: employmentType as EmployeeMutationInput['employmentType'],
    salary,
    hireDate,
    status: status as EmployeeMutationInput['status'],
    notes: text(row.notes, 2000),
  };
}
