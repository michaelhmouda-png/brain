export const RESERVATION_STATUSES = ['pending', 'confirmed', 'waitlisted', 'seated', 'completed', 'cancelled', 'no_show'] as const;
export const WAITLIST_STATUSES = ['waiting', 'contacted', 'offered', 'converted', 'expired', 'cancelled'] as const;
export const RESERVATION_SOURCES = ['manual', 'phone', 'whatsapp', 'instagram', 'website', 'google', 'walk_in', 'ai_concierge', 'other'] as const;
export const RESERVATION_PURPOSES = ['regular', 'birthday', 'anniversary', 'business', 'engagement', 'bachelor', 'bachelorette', 'family', 'event', 'other'] as const;
export const SEATING_PREFERENCES = ['no_preference', 'indoor', 'outdoor', 'bar', 'vip'] as const;
export const RESERVATION_EVENT_TYPES = ['reservation.created', 'reservation.confirmed', 'reservation.waitlisted', 'reservation.seated', 'reservation.completed', 'reservation.cancelled', 'reservation.no_show'] as const;

export type ReservationStatus = typeof RESERVATION_STATUSES[number];
export type WaitlistStatus = typeof WAITLIST_STATUSES[number];
export type ReservationSource = typeof RESERVATION_SOURCES[number];
export type ReservationPurpose = typeof RESERVATION_PURPOSES[number];
export type SeatingPreference = typeof SEATING_PREFERENCES[number];

export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const isTime = (value: unknown): value is string =>
  typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export const oneOf = <T extends readonly string[]>(values: T, value: unknown): value is T[number] =>
  typeof value === 'string' && values.includes(value);

export type ManualReservationInput = {
  firstName: string;
  lastName: string;
  countryCallingCode: string;
  phoneNumber: string;
  guestCount: number;
  purpose: ReservationPurpose;
  purposeDetails?: string;
  date: string;
  time: string;
  expectedDurationMinutes: number;
  notes?: string;
  seatingPreference: SeatingPreference;
  source: ReservationSource;
  locationId: string;
  waitlist: boolean;
  earliestTime?: string;
  latestTime?: string;
};

export type ReservationSafeRecord = {
  id: string;
  locationId: string;
  guestId: string;
  guestName: string;
  phoneE164: string;
  guestCount: number;
  reservationDate: string;
  reservationTime: string;
  startsAt: string;
  expectedEndAt: string | null;
  purpose: ReservationPurpose;
  purposeDetails: string | null;
  seatingPreference: SeatingPreference;
  status: ReservationStatus;
  source: ReservationSource;
  hasNotes: boolean;
  createdByName: string | null;
  createdAt: string;
};

export type ReservationTimelineProjection = {
  eventType: typeof RESERVATION_EVENT_TYPES[number];
  sourceType: 'reservation';
  sourceId: string;
  correlationId: string;
  occurredAt: string;
  metadata: { locationId: string; status: ReservationStatus };
};
