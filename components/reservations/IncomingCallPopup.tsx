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
    <aside role="dialog" aria-label="Incoming venue call" className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-[24px] border border-cyan-300/25 bg-[#090e15]/98 shadow-[0_28px_90px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:left-auto sm:right-4 sm:w-[420px]">
      <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-cyan-300"><span className="grid h-7 w-7 place-items-center rounded-full bg-cyan-300/10"><PhoneCall className="h-3.5 w-3.5" /></span> Incoming call</p>
        <button type="button" onClick={onDismiss} className="grid min-h-9 min-w-9 place-items-center rounded-xl text-slate-500 hover:bg-white/[0.06]" aria-label="Dismiss incoming call"><X className="h-4 w-4" /></button>
      </header>
      <div className="p-4">
        <h2 className="text-2xl font-black tracking-tight">{call.callerPhone}</h2>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-400"><UserRound className="h-3.5 w-3.5" />{call.existingGuest?.name ?? 'New caller'}</p>
        <dl className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white/[0.04] p-2.5"><dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><History className="h-3 w-3" />Visits</dt><dd className="mt-1 font-bold">{call.previousVisitCount}</dd></div>
          <div className="rounded-xl bg-white/[0.04] p-2.5"><dt className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><UsersRound className="h-3 w-3" />Usual party</dt><dd className="mt-1 font-bold">{call.usualGuestCount ?? '—'}</dd></div>
          <div className="rounded-xl bg-white/[0.04] p-2.5"><dt className="text-[10px] uppercase tracking-wide text-slate-500">Seating</dt><dd className="mt-1 truncate font-bold">{call.seatingPreference ?? '—'}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">Latest visit: {call.latestVisitDate ?? 'None'}{call.hasGuestNotes ? ' · Guest notes available' : ''}</p>
        <button className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 font-black text-slate-950" onClick={() => onNewReservation(call)}><Phone className="h-4 w-4" /> Start booking</button>
        {call.existingGuest ? <button className="mt-2 min-h-10 w-full rounded-xl border border-white/10 text-sm font-semibold text-slate-300" onClick={() => onViewGuest(call.existingGuest!.id)}>Open guest profile</button> : null}
      </div>
    </aside>
  );
}
