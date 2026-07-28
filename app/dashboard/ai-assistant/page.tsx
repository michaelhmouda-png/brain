'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BrainMark } from '@/components/brain-experience/BrainMark';
import { useLocale } from '@/components/LocaleProvider';

/** Saved assistant links now open the one persistent Brain surface. */
export default function BrainCompatibilityRoute() {
  const router = useRouter();
  const { messages: t } = useLocale();

  useEffect(() => {
    router.replace('/dashboard?brain=open');
  }, [router]);

  return (
    <div className="grid min-h-[50dvh] place-items-center">
      <div className="text-center">
        <span className="brain-logo-tile mx-auto"><BrainMark className="h-7 w-7" /></span>
        <h1 className="mt-4 text-xl font-semibold text-slate-950">{t.assistant.compatibilityOpening}</h1>
        <p className="mt-2 text-sm text-slate-500">{t.assistant.compatibilityHelp}</p>
      </div>
    </div>
  );
}
