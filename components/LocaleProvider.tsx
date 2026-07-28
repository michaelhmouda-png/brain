'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { getMessages, normalizeLanguage, type Language, type TranslationMessages } from '@/lib/i18n';

type Role = 'super_admin'|'owner'|'manager'|'employee';
type LocaleContextValue = {
  language: Language;
  role: Role;
  companyTimezone: string;
  messages: TranslationMessages;
};
const LocaleContext = createContext<LocaleContextValue>({
  language: 'en',
  role: 'employee',
  companyTimezone: 'UTC',
  messages: getMessages('en'),
});

export function LocaleProvider({
  language: input,
  role,
  companyTimezone,
  children,
}: {
  language: Language;
  role: Role;
  companyTimezone: string;
  children: ReactNode;
}) {
  const language = normalizeLanguage(input);
  const messages = getMessages(language);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  }, [language]);
  return (
    <LocaleContext.Provider value={{ language, role, companyTimezone, messages }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() { return useContext(LocaleContext); }
