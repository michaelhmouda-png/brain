import type { ReservationStatus, WaitlistStatus } from './contracts.ts';

export const ACTIVE_EXPECTED_RESERVATION_STATUSES = ['pending', 'confirmed', 'seated'] as const;
export const ACTIVE_ARRIVAL_RESERVATION_STATUSES = ['pending', 'confirmed'] as const;
export const ACTIVE_WAITLIST_STATUSES = ['waiting', 'contacted', 'offered'] as const;

type ReservationMetricRow = {
  guest_count: number;
  status: string;
  reservation_time?: string;
};

type WaitlistMetricRow = {
  guest_count: number;
  status: string;
};

export type ReservationDailyMetrics = {
  activeReservations: number;
  expectedGuests: number;
  confirmedReservations: number;
  pendingReservations: number;
  waitingListCount: number;
  waitingListGuests: number;
  seatedReservations: number;
  seatedGuests: number;
  cancelledReservations: number;
  noShowReservations: number;
  completedReservations: number;
};

const hasStatus = <T extends readonly string[]>(statuses: T, status: string): status is T[number] =>
  statuses.includes(status);

export function aggregateReservationMetrics(
  reservations: ReservationMetricRow[],
  waitlist: WaitlistMetricRow[] = [],
): ReservationDailyMetrics {
  const activeReservations = reservations.filter((row) =>
    hasStatus(ACTIVE_EXPECTED_RESERVATION_STATUSES, row.status),
  );
  const reservationWaitlist = reservations.filter((row) => row.status === 'waitlisted');
  const activeWaitlist = waitlist.filter((row) => hasStatus(ACTIVE_WAITLIST_STATUSES, row.status));

  return {
    activeReservations: activeReservations.length,
    expectedGuests: activeReservations.reduce((sum, row) => sum + row.guest_count, 0),
    confirmedReservations: reservations.filter((row) => row.status === 'confirmed').length,
    pendingReservations: reservations.filter((row) => row.status === 'pending').length,
    waitingListCount: reservationWaitlist.length + activeWaitlist.length,
    waitingListGuests:
      reservationWaitlist.reduce((sum, row) => sum + row.guest_count, 0)
      + activeWaitlist.reduce((sum, row) => sum + row.guest_count, 0),
    seatedReservations: reservations.filter((row) => row.status === 'seated').length,
    seatedGuests: reservations
      .filter((row) => row.status === 'seated')
      .reduce((sum, row) => sum + row.guest_count, 0),
    cancelledReservations: reservations.filter((row) => row.status === 'cancelled').length,
    noShowReservations: reservations.filter((row) => row.status === 'no_show').length,
    completedReservations: reservations.filter((row) => row.status === 'completed').length,
  };
}

export function isExpectedArrivalStatus(status: string): status is ReservationStatus {
  return hasStatus(ACTIVE_EXPECTED_RESERVATION_STATUSES, status);
}

export function isUpcomingArrivalStatus(status: string): status is ReservationStatus {
  return hasStatus(ACTIVE_ARRIVAL_RESERVATION_STATUSES, status);
}

export function isActiveWaitlistStatus(status: string): status is WaitlistStatus {
  return hasStatus(ACTIVE_WAITLIST_STATUSES, status);
}
