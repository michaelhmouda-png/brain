import type { ReactNode } from 'react';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { DashboardSidebar } from '@/components/DashboardSidebar';

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
    .select('*')
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

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
      <div className="safe-area-x relative mx-auto flex min-h-[100dvh] max-w-[1700px] flex-col gap-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[calc(4.5rem+env(safe-area-inset-top))] lg:flex-row lg:gap-6 lg:px-8 lg:py-6">
        <DashboardSidebar profile={profile} userName={user.email || null} />

        <main className="dashboard-main flex-1">{children}</main>
      </div>
    </div>
  );
}
