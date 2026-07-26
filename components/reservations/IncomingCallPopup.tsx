'use client';

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
    <aside role="dialog" aria-label="Incoming venue call" className="fixed bottom-4 right-4 z-50 w-[min(calc(100vw-2rem),420px)] rounded-3xl border border-cyan-400/30 bg-slate-950 p-5 shadow-2xl">
      <p className="text-xs uppercase tracking-[.2em] text-cyan-300">Incoming call</p>
      <h2 className="mt-2 text-2xl font-black">{call.callerPhone}</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-slate-400">Guest</dt><dd>{call.existingGuest?.name ?? 'New caller'}</dd></div>
        <div><dt className="text-slate-400">Previous visits</dt><dd>{call.previousVisitCount}</dd></div>
        <div><dt className="text-slate-400">Latest visit</dt><dd>{call.latestVisitDate ?? 'None'}</dd></div>
        <div><dt className="text-slate-400">Usual party</dt><dd>{call.usualGuestCount ?? 'Unknown'}</dd></div>
        <div><dt className="text-slate-400">Seating</dt><dd>{call.seatingPreference ?? 'Unknown'}</dd></div>
        <div><dt className="text-slate-400">Notes</dt><dd>{call.hasGuestNotes ? 'Available' : 'None'}</dd></div>
      </dl>
      <div className="mt-5 flex flex-wrap gap-2">
        <button className="rounded-xl bg-cyan-400 px-4 py-2 font-bold text-slate-950" onClick={() => onNewReservation(call)}>New Reservation</button>
        {call.existingGuest ? <button className="rounded-xl border border-white/15 px-4 py-2" onClick={() => onViewGuest(call.existingGuest!.id)}>View Guest</button> : null}
        <button className="rounded-xl border border-white/15 px-4 py-2" onClick={onDismiss}>Dismiss</button>
      </div>
    </aside>
  );
}
