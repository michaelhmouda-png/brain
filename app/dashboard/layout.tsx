import type { ReactNode } from 'react';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { LocaleProvider } from '@/components/LocaleProvider';
import { normalizeLanguage } from '@/lib/i18n';
import { BrainExperienceShell } from '@/components/brain-experience/BrainExperienceShell';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // Note: Proxy.ts already redirects unauthenticated users away from /dashboard
  // This getUser() call is for validation only; we don't redirect here
  const supabase = await createSupabaseServerAuth();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If no user, proxy should have already redirected to /login
  if (!user) {
    return (
      <div className="min-h-screen overflow-hidden bg-[#020202] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
        <div className="relative mx-auto flex min-h-screen max-w-[1700px] items-center justify-center px-4 py-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl max-w-md">
            <h1 className="text-2xl font-bold text-white">Authentication Error</h1>
            <p className="mt-4 text-slate-400">
              Unable to verify your authentication. Please log in again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, company_id, employee_id, full_name, role, status, preferred_language, created_at, updated_at')
    .eq('id', user.id)
    .single();

  // Check if user has a profile (account setup required)
  if (!profile) {
    return (
      <div className="min-h-screen overflow-hidden bg-[#020202] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
        <div className="relative mx-auto flex min-h-screen max-w-[1700px] items-center justify-center px-4 py-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl max-w-md">
            <h1 className="text-2xl font-bold text-white">Account Setup Required</h1>
            <p className="mt-4 text-slate-400">
              Your account has not been set up yet. Please contact your administrator to complete the setup process.
            </p>
            <p className="mt-2 text-sm text-slate-500">User ID: {user.id}</p>
          </div>
        </div>
      </div>
    );
  }

  // Check if user account is active
  if (profile.status !== 'active') {
    return (
      <div className="min-h-screen overflow-hidden bg-[#020202] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
        <div className="relative mx-auto flex min-h-screen max-w-[1700px] items-center justify-center px-4 py-6">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl max-w-md">
            <h1 className="text-2xl font-bold text-white">Account Inactive</h1>
            <p className="mt-4 text-slate-400">
              Your account is currently <span className="capitalize font-medium">{profile.status}</span>. Please contact your administrator.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { data: company } = profile.company_id
    ? await supabase.from('companies').select('name').eq('id', profile.company_id).maybeSingle()
    : { data: null };

  const language = normalizeLanguage(profile.preferred_language);
  return (
    <LocaleProvider language={language} role={profile.role}>
      <div lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <BrainExperienceShell profile={profile} userName={user.email || null} companyName={company?.name ?? null}>
          {children}
        </BrainExperienceShell>
      </div>
    </LocaleProvider>
  );
}
