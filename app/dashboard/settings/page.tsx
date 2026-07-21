'use client';
import { NotificationSettings } from '@/components/NotificationSettings';
import { LanguageSettings } from '@/components/LanguageSettings';
import { useLocale } from '@/components/LocaleProvider';
export default function SettingsPage() {
  const { messages: t, role } = useLocale();
  return (
    <div className="space-y-8 rounded-[36px] border border-white/10 bg-white/5 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div>
        <p className="text-sm uppercase tracking-[0.35em] text-cyan-300">{t.settings.eyebrow}</p>
        <h1 className="mt-4 text-4xl font-black text-white">{t.settings.title}</h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          {t.settings.description}
        </p>
      </div>
      <LanguageSettings />
      <NotificationSettings />
      {role !== 'employee' && <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {[
          { label: "Workspace", description: "Venue preferences and branding" },
          { label: "Notifications", description: "Alert thresholds and channels" },
          { label: "Security", description: "Access controls and audit" },
        ].map((item) => (
          <article key={item.label} className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-slate-300 transition hover:-translate-y-1 hover:bg-slate-900/90">
            <p className="text-lg font-semibold text-white">{item.label}</p>
            <p className="mt-4 text-sm text-slate-400">{item.description}</p>
          </article>
        ))}
      </div>}
    </div>
  );
}
