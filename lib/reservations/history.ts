import { aggregateReservationMetrics } from './metrics.ts';

export const sameDateLastYear = (date: string) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() - 1);
  return value.toISOString().slice(0, 10);
};

export const comparableWeekdayLastYear = (date: string) => {
  const current = new Date(`${date}T12:00:00Z`);
  const target = new Date(current);
  target.setUTCFullYear(target.getUTCFullYear() - 1);
  target.setUTCDate(target.getUTCDate() + current.getUTCDay() - target.getUTCDay());
  return target.toISOString().slice(0, 10);
};

export function aggregateCalendar(
  rows: Array<{ reservation_date: string; guest_count: number; status: string }>,
  waitlistRows: Array<{ requested_date: string; guest_count: number; status: string }> = [],
) {
  const dates = new Set([
    ...rows.map((row) => row.reservation_date),
    ...waitlistRows.map((row) => row.requested_date),
  ]);
  const days: Record<string, ReturnType<typeof aggregateReservationMetrics>> = {};
  for (const date of dates) {
    days[date] = aggregateReservationMetrics(
      rows.filter((row) => row.reservation_date === date),
      waitlistRows.filter((row) => row.requested_date === date),
    );
  }
  return days;
}
