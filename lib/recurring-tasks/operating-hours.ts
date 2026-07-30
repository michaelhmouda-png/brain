import {
  WEEKDAYS,
  type OperatingHoursConfigurationInput,
  type OperatingHoursDayInput,
} from './contracts.ts';

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_OPENS_AT = '09:00';
const DEFAULT_CLOSES_AT = '23:00';

export interface OperatingHoursDatabaseRow {
  location_id: string;
  weekday: number;
  is_closed: boolean;
  opens_at: string | null;
  closes_at: string | null;
}

export interface LocationOperatingHours extends OperatingHoursDayInput {
  locationId: string;
}

export interface OperatingHoursDraftDay {
  weekday: number;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
}

function localTime(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.slice(0, 5);
  return LOCAL_TIME.test(normalized) ? normalized : null;
}

/**
 * The only database representation boundary for operating hours.
 * PostgreSQL stores the negative `is_closed`; the application uses only `isOpen`.
 */
export function operatingHoursFromDatabaseRows(rows: readonly OperatingHoursDatabaseRow[]): LocationOperatingHours[] {
  return rows.map((row) => {
    if (typeof row.location_id !== 'string' || !WEEKDAYS.includes(row.weekday as never)
        || typeof row.is_closed !== 'boolean') {
      throw new Error('RECURRING_UNAVAILABLE');
    }
    const isOpen = !row.is_closed;
    if (!isOpen) {
      if (row.opens_at !== null || row.closes_at !== null) throw new Error('RECURRING_UNAVAILABLE');
      return { locationId: row.location_id, weekday: row.weekday, isOpen, opensAt: null, closesAt: null };
    }
    const opensAt = localTime(row.opens_at);
    const closesAt = localTime(row.closes_at);
    if (!opensAt || !closesAt) throw new Error('RECURRING_UNAVAILABLE');
    return { locationId: row.location_id, weekday: row.weekday, isOpen, opensAt, closesAt };
  });
}

export function operatingHoursToRpcDays(days: readonly OperatingHoursDayInput[]) {
  return days.map((day) => ({
    weekday: day.weekday,
    isClosed: !day.isOpen,
    opensAt: day.isOpen ? day.opensAt : null,
    closesAt: day.isOpen ? day.closesAt : null,
  }));
}

export function createOperatingHoursDraft(
  rows: readonly LocationOperatingHours[],
  locationId: string,
): OperatingHoursDraftDay[] {
  return WEEKDAYS.map((weekday) => {
    const stored = rows.find((row) => row.locationId === locationId && row.weekday === weekday);
    return {
      weekday,
      isOpen: stored?.isOpen ?? false,
      opensAt: localTime(stored?.opensAt) ?? DEFAULT_OPENS_AT,
      closesAt: localTime(stored?.closesAt) ?? DEFAULT_CLOSES_AT,
    };
  });
}

export function updateOperatingHoursDraftDay(
  days: readonly OperatingHoursDraftDay[],
  weekday: number,
  change: Partial<Pick<OperatingHoursDraftDay, 'isOpen'|'opensAt'|'closesAt'>>,
) {
  return days.map((day) => day.weekday === weekday ? { ...day, ...change } : day);
}

export function operatingHoursStateLabel(
  weekdayLabel: string,
  isOpen: boolean,
  labels: { open: string; closed: string },
) {
  return `${weekdayLabel} · ${isOpen ? labels.open : labels.closed}`;
}

export function serializeOperatingHoursDraft(
  locationId: string,
  days: readonly OperatingHoursDraftDay[],
): OperatingHoursConfigurationInput {
  return {
    locationId,
    days: days.map((day) => ({
      weekday: day.weekday,
      isOpen: day.isOpen,
      opensAt: day.isOpen ? day.opensAt : null,
      closesAt: day.isOpen ? day.closesAt : null,
    })),
  };
}
