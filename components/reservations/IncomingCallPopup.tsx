'use client';

import { History, Phone, PhoneCall, UserRound, UsersRound, X } from 'lucide-react';
import type { SafeIncomingCallPopup } from '@/lib/reservations/telephony';

export function IncomingCallPopup({
  call,
  onNewReservation,
  onViewGuest,
  onDismiss,
}: {
  call: SafeIncomingCallPopup;
  onNewReservation(call: SafeIncomingCallPopup): void;
  onViewGuest(guestId: string): void;
  onDismiss(): void;
}) {
  return (
    <aside role="dialog" aria-label="Incoming venue call" className="ui-management-surface fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-[24px] border sm:start-auto sm:end-4 sm:w-[420px]">
      <header className="ui-management-divider flex items-center justify-between border-b px-4 py-3">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-[var(--ui-action-primary)]"><span className="grid h-7 w-7 place-items-center rounded-full bg-cyan-50"><PhoneCall className="h-3.5 w-3.5" /></span> Incoming call</p>
        <button type="button" onClick={onDismiss} className="ui-button-secondary min-h-9 min-w-9 p-0" aria-label="Dismiss incoming call"><X className="h-4 w-4" /></button>
      </header>
      <div className="p-4">
        <h2 className="text-2xl font-black tracking-tight">{call.callerPhone}</h2>
        <p className="ui-muted mt-1 flex items-center gap-1.5 text-sm"><UserRound className="h-3.5 w-3.5" />{call.existingGuest?.name ?? 'New caller'}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <div className="ui-management-inset rounded-xl border p-2.5"><dt className="ui-muted flex items-center gap-1 text-[10px] uppercase tracking-wide"><History className="h-3 w-3" />Visits</dt><dd className="mt-1 font-bold">{call.previousVisitCount}</dd></div>
          <div className="ui-management-inset rounded-xl border p-2.5"><dt className="ui-muted flex items-center gap-1 text-[10px] uppercase tracking-wide"><UsersRound className="h-3 w-3" />Usual party</dt><dd className="mt-1 font-bold">{call.usualGuestCount ?? '—'}</dd></div>
          <div className="ui-management-inset rounded-xl border p-2.5"><dt className="ui-muted text-[10px] uppercase tracking-wide">Seating</dt><dd className="mt-1 truncate font-bold">{call.seatingPreference ?? '—'}</dd></div>
        </dl>
        <p className="ui-muted mt-3 text-xs">Latest visit: {call.latestVisitDate ?? 'None'}{call.hasGuestNotes ? ' · Guest notes available' : ''}</p>
        <button className="ui-button-primary mt-4 min-h-12 w-full" onClick={() => onNewReservation(call)}><Phone className="h-4 w-4" /> Start booking</button>
        {call.existingGuest ? <button className="ui-button-secondary mt-2 min-h-10 w-full text-sm" onClick={() => onViewGuest(call.existingGuest!.id)}>Open guest profile</button> : null}
      </div>
    </aside>
  );
}
