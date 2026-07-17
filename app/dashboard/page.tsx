'use client';

import { PremiumCommandCenter } from '@/components/PremiumCommandCenter';

export default function DashboardPage() {
  return (
    <section className="relative overflow-hidden rounded-[40px] border border-white/10 bg-white/5 p-8 shadow-[0_35px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex flex-col gap-8">
        {/* Premium Command Center */}
        <PremiumCommandCenter />
      </div>
    </section>
  );
}
