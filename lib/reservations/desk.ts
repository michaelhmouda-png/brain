export const RESERVATION_DESK_FILTERS = [
  'all',
  'active',
  'waiting',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const RESERVATION_DESK_SORTS = [
  'time_asc',
  'time_desc',
  'guest_name',
  'party_size',
] as const;

export type ReservationDeskFilter = typeof RESERVATION_DESK_FILTERS[number];
export type ReservationDeskSort = typeof RESERVATION_DESK_SORTS[number];

export type ReservationDeskRow = {
  reservation_time: string;
  guest_count: number;
  status: string;
  guest: { first_name: string; last_name: string; phone_e164: string } | null;
};

const guestName = (row: ReservationDeskRow) =>
  row.guest ? `${row.guest.first_name} ${row.guest.last_name}`.trim() : '';

export function shiftVenueDate(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day + days, 12));
  return [
    instant.getUTCFullYear(),
    String(instant.getUTCMonth() + 1).padStart(2, '0'),
    String(instant.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function projectReservationDeskRows<T extends ReservationDeskRow>(
  rows: readonly T[],
  search: string,
  filter: ReservationDeskFilter,
  sort: ReservationDeskSort,
) {
  const needle = search.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (filter === 'active' && !['pending', 'confirmed'].includes(row.status)) return false;
    if (!['all', 'active', 'waiting'].includes(filter) && row.status !== filter) return false;
    if (!needle) return true;
    const searchable = [
      guestName(row),
      row.guest?.phone_e164 ?? '',
      row.status,
    ].join(' ').toLocaleLowerCase();
    return searchable.includes(needle);
  });

  return filtered.toSorted((left, right) => {
    if (sort === 'time_desc') return right.reservation_time.localeCompare(left.reservation_time);
    if (sort === 'guest_name') return guestName(left).localeCompare(guestName(right));
    if (sort === 'party_size') {
      return right.guest_count - left.guest_count
        || left.reservation_time.localeCompare(right.reservation_time);
    }
    return left.reservation_time.localeCompare(right.reservation_time);
  });
}
