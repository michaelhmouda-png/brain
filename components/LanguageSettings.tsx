'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from './LocaleProvider';
import type { Language } from '@/lib/i18n';

export function LanguageSettings() {
  const { language, messages: t } = useLocale();
  const router = useRouter();
  const [selected, setSelected] = useState<Language>(language);
  const [state, setState] = useState<'idle'|'saving'|'saved'|'failed'>('idle');
  async function save() {
    setState('saving');
    const response = await fetch('/api/profile/language', { method: 'PATCH', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: selected }) }).catch(() => null);
    if (!response?.ok) { setState('failed'); return; }
    setState('saved'); router.refresh(); window.location.reload();
  }
  return <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5">
    <label htmlFor="preferred-language" className="text-lg font-semibold text-white">{t.settings.language}</label>
    <p className="mt-1 text-sm text-slate-400">{t.settings.languageHelp}</p>
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
      <select id="preferred-language" value={selected} onChange={(event) => setSelected(event.target.value as Language)} className="min-h-11 rounded-xl border border-white/15 bg-slate-900 px-4 text-base text-white">
        <option value="en">{t.settings.english}</option><option value="ar">{t.settings.arabic}</option>
      </select>
      <button type="button" onClick={() => void save()} disabled={state === 'saving' || selected === language} className="min-h-11 rounded-xl bg-cyan-600 px-5 font-semibold text-white disabled:opacity-50">{state === 'saving' ? t.settings.saving : t.settings.save}</button>
    </div>
    {state === 'saved' && <p className="mt-3 text-sm text-emerald-300" role="status">{t.settings.saved}</p>}
    {state === 'failed' && <p className="mt-3 text-sm text-red-300" role="alert">{t.settings.failed}</p>}
  </section>;
}
