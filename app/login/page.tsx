import { redirect } from 'next/navigation';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';
import { LoginForm } from '@/components/LoginForm';

export const metadata = {
  title: 'Login — Brain',
  description: 'Sign in to your Brain account',
};

export default async function LoginPage() {
  // Use server-side auth client to check session from cookies
  // This ensures we read the same cookie that browser client sets
  const supabase = await createSupabaseServerAuth();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  console.log('[LoginPage] pathname=/login, user:', user ? 'exists' : 'null', ', redirect:', user ? '/dashboard' : 'none');

  // Redirect authenticated users to dashboard
  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-[#020202] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(96,165,250,0.14),_transparent_18%)]" />
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <LoginForm />
      </div>
    </div>
  );
}
