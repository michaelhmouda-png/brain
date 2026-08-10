import CustomerOnboardingForm from '@/components/CustomerOnboardingForm';
import { resolveActorContext } from '@/lib/brain/kernel/actor-context.server';
import { createSupabaseServerAuth } from '@/lib/supabaseServer';

export default async function NewCompanyPage() {
  const actor = await resolveActorContext(await createSupabaseServerAuth());
  if (actor.role !== 'super_admin') {
    return <div role="alert" className="brain-surface p-6 text-red-700">Customer provisioning requires super-admin authorization.</div>;
  }
  return (
    <div className="space-y-8">
      <CustomerOnboardingForm />
    </div>
  );
}
