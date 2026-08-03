const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface CreateConcreteShiftInput {
  employeeId: string;
  locationId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export type WeeklyShiftScheduleInput = {
  employeeIds: string[];
  locationId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  startDate: string;
  endDate: string | null;
};

function exactRecord(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SHIFT_INPUT_INVALID');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error('SHIFT_INPUT_INVALID');
  return record;
}

export function canManageShifts(role: string) {
  return role === 'manager' || role === 'owner' || role === 'super_admin';
}

export function parseCreateConcreteShift(value: unknown): CreateConcreteShiftInput {
  const row = exactRecord(value, ['employeeId', 'locationId', 'date', 'startTime', 'endTime']);
  if (typeof row.employeeId !== 'string' || !UUID.test(row.employeeId)
      || typeof row.locationId !== 'string' || !UUID.test(row.locationId)
      || typeof row.date !== 'string' || !DATE.test(row.date)
      || typeof row.startTime !== 'string' || !TIME.test(row.startTime)
      || typeof row.endTime !== 'string' || !TIME.test(row.endTime)) {
    throw new Error('SHIFT_INPUT_INVALID');
  }
  return {
    employeeId: row.employeeId,
    locationId: row.locationId,
    date: row.date,
    startTime: row.startTime,
    endTime: row.endTime,
  };
}

export function parseWeeklyShiftSchedule(value: unknown): WeeklyShiftScheduleInput {
  const row = exactRecord(value, ['employeeIds', 'locationId', 'weekdays', 'startTime', 'endTime', 'startDate', 'endDate']);
  if (!Array.isArray(row.employeeIds) || row.employeeIds.length < 1 || row.employeeIds.length > 100
      || row.employeeIds.some((id) => typeof id !== 'string' || !UUID.test(id))
      || new Set(row.employeeIds).size !== row.employeeIds.length
      || typeof row.locationId !== 'string' || !UUID.test(row.locationId)
      || !Array.isArray(row.weekdays) || row.weekdays.length < 1 || row.weekdays.length > 7
      || row.weekdays.some((day) => !Number.isInteger(day) || Number(day) < 0 || Number(day) > 6)
      || new Set(row.weekdays).size !== row.weekdays.length
      || typeof row.startTime !== 'string' || !TIME.test(row.startTime)
      || typeof row.endTime !== 'string' || !TIME.test(row.endTime)
      || typeof row.startDate !== 'string' || !DATE.test(row.startDate)
      || row.endDate !== null && (typeof row.endDate !== 'string' || !DATE.test(row.endDate))
      || typeof row.endDate === 'string' && row.endDate < row.startDate) throw new Error('WEEKLY_SHIFT_INPUT_INVALID');
  return {
    employeeIds: [...row.employeeIds] as string[],
    locationId: row.locationId,
    weekdays: [...row.weekdays].map(Number).sort((a, b) => a - b),
    startTime: row.startTime,
    endTime: row.endTime,
    startDate: row.startDate,
    endDate: row.endDate as string | null,
  };
}

export function nextLocalDate(date: string) {
  if (!DATE.test(date)) throw new Error('SHIFT_INPUT_INVALID');
  const instant = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) {
    throw new Error('SHIFT_INPUT_INVALID');
  }
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}
