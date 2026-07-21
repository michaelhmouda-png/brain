'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { messages, normalizeLanguage, type Language, type TranslationMessages } from '@/lib/i18n';

type Role = 'super_admin'|'owner'|'manager'|'employee';
const LocaleContext = createContext<{ language: Language; role: Role; messages: TranslationMessages }>({ language: 'en', role: 'employee', messages: messages.en });

export function LocaleProvider({ language: input, role, children }: { language: Language; role: Role; children: ReactNode }) {
  const language = normalizeLanguage(input);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);
  return <LocaleContext.Provider value={{ language, role, messages: messages[language] as TranslationMessages }}>{children}</LocaleContext.Provider>;
}

export function useLocale() { return useContext(LocaleContext); }
