import { PremiumCommandCenter } from '@/components/PremiumCommandCenter';
import { EmployeeHome } from '@/components/EmployeeHome';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export default async function DashboardPage() {
  const supabase = await createSupabaseServerAuth();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user ? await supabase.from('profiles').select('role,status').eq('id', user.id).maybeSingle() : { data: null };
  if (profile?.status === 'active' && profile.role === 'employee') return <EmployeeHome />;
  return (
    <section className="relative overflow-hidden rounded-[40px] border border-white/10 bg-white/5 p-8 shadow-[0_35px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex flex-col gap-8">
        {/* Premium Command Center */}
        <PremiumCommandCenter />
      </div>
    </section>
  );
}
