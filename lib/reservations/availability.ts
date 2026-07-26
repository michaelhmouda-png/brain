export type AvailabilityRequest = {
  companyId: string;
  locationId: string;
  startsAt: string;
  guestCount: number;
  seatingPreference: string;
};

export type AvailabilityResult = {
  state: 'unknown';
  reason: 'CAPACITY_RULES_NOT_CONFIGURED';
};

export interface ReservationAvailabilityProvider {
  check(input: AvailabilityRequest): Promise<AvailabilityResult>;
}

export const unknownAvailabilityProvider: ReservationAvailabilityProvider = {
  async check() {
    return { state: 'unknown', reason: 'CAPACITY_RULES_NOT_CONFIGURED' };
  },
};
