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

export function aggregateCalendar(rows: Array<{ reservation_date: string; guest_count: number; status: string }>) {
  const days: Record<string, { reservationCount: number; expectedGuests: number; confirmed: number; waiting: number; cancelled: number; noShows: number }> = {};
  for (const row of rows) {
    const day = days[row.reservation_date] ?? { reservationCount: 0, expectedGuests: 0, confirmed: 0, waiting: 0, cancelled: 0, noShows: 0 };
    day.reservationCount += 1; day.expectedGuests += row.guest_count;
    if (row.status === 'confirmed') day.confirmed += 1;
    if (row.status === 'waitlisted') day.waiting += 1;
    if (row.status === 'cancelled') day.cancelled += 1;
    if (row.status === 'no_show') day.noShows += 1;
    days[row.reservation_date] = day;
  }
  return days;
}
