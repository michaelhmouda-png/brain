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

export function nextLocalDate(date: string) {
  if (!DATE.test(date)) throw new Error('SHIFT_INPUT_INVALID');
  const instant = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(instant.valueOf()) || instant.toISOString().slice(0, 10) !== date) {
    throw new Error('SHIFT_INPUT_INVALID');
  }
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}
