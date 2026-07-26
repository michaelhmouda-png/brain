import { normalizePhone } from './phone.ts';

export type IncomingCallEvent = {
  provider: string;
  providerCallId: string;
  destinationNumber: string;
  callerNumber: string;
  occurredAt: string;
};

export type SafeIncomingCallPopup = {
  sessionId: string;
  callerPhone: string;
  countryCallingCode: string;
  existingGuest: { id: string; name: string } | null;
  previousVisitCount: number;
  latestVisitDate: string | null;
  usualGuestCount: number | null;
  seatingPreference: string | null;
  hasGuestNotes: boolean;
  expiresAt: string;
};

export interface TelephonyProviderAdapter {
  readonly providerName: string;
  verifySignature(rawBody: string, signature: string): Promise<boolean>;
  parseIncomingCall(rawBody: string): IncomingCallEvent;
}

export class MockTelephonyProviderAdapter implements TelephonyProviderAdapter {
  readonly providerName = 'mock';
  async verifySignature(_rawBody: string, signature: string) {
    return signature === 'valid-test-signature';
  }
  parseIncomingCall(rawBody: string): IncomingCallEvent {
    const value: unknown = JSON.parse(rawBody);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('TELEPHONY_EVENT_INVALID');
    const row = value as Record<string, unknown>;
    if (typeof row.providerCallId !== 'string' || typeof row.destinationNumber !== 'string'
        || typeof row.callerNumber !== 'string' || typeof row.occurredAt !== 'string') {
      throw new Error('TELEPHONY_EVENT_INVALID');
    }
    if (!/^\+[1-9]\d{7,14}$/.test(row.callerNumber)) throw new Error('TELEPHONY_CALLER_INVALID');
    return { provider: 'mock', providerCallId: row.providerCallId, destinationNumber: row.destinationNumber, callerNumber: row.callerNumber, occurredAt: row.occurredAt };
  }
}

export const FUTURE_TELEPHONY_PATHS = ['sip_pbx', 'cloud_voip', 'local_telephony_bridge', 'approved_mobile_companion'] as const;

export interface IncomingCallAccess {
  resolveDestination(provider: string, destinationPhone: string): Promise<{ companyId: string; locationId: string } | null>;
  findGuest(companyId: string, callerPhone: string): Promise<{ id: string; name: string; hasNotes: boolean } | null>;
  loadHistory(companyId: string, guestId: string): Promise<{ previousVisitCount: number; latestVisitDate: string | null; usualGuestCount: number | null; seatingPreference: string | null }>;
  createSession(input: { companyId: string; locationId: string; provider: string; providerCallId: string; callerPhone: string; destinationPhone: string; guestId: string | null; startedAt: string; expiresAt: string }): Promise<string>;
  publishToAuthorizedOperators(companyId: string, locationId: string, popup: SafeIncomingCallPopup): Promise<void>;
}

export async function handleIncomingCall(rawBody: string, signature: string, adapter: TelephonyProviderAdapter, access: IncomingCallAccess) {
  if (!await adapter.verifySignature(rawBody, signature)) throw new Error('TELEPHONY_SIGNATURE_INVALID');
  const event = adapter.parseIncomingCall(rawBody);
  const destination = await access.resolveDestination(adapter.providerName, event.destinationNumber);
  if (!destination) throw new Error('TELEPHONY_DESTINATION_UNKNOWN');
  const caller = event.callerNumber.startsWith('+') ? event.callerNumber : normalizePhone('+1', event.callerNumber).phoneE164;
  const guest = await access.findGuest(destination.companyId, caller);
  const history = guest ? await access.loadHistory(destination.companyId, guest.id) : { previousVisitCount: 0, latestVisitDate: null, usualGuestCount: null, seatingPreference: null };
  const expiresAt = new Date(Date.parse(event.occurredAt) + 10 * 60_000).toISOString();
  const sessionId = await access.createSession({ ...destination, provider: adapter.providerName, providerCallId: event.providerCallId, callerPhone: caller, destinationPhone: event.destinationNumber, guestId: guest?.id ?? null, startedAt: event.occurredAt, expiresAt });
  const popup: SafeIncomingCallPopup = { sessionId, callerPhone: caller, countryCallingCode: caller.slice(0, Math.min(4, caller.length - 4)), existingGuest: guest ? { id: guest.id, name: guest.name } : null, ...history, hasGuestNotes: guest?.hasNotes ?? false, expiresAt };
  await access.publishToAuthorizedOperators(destination.companyId, destination.locationId, popup);
  return popup;
}
