'use client';

import { useRef, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';

type UserDraft = { email: string; firstName: string; lastName: string; jobTitle: string; department: string; role: 'owner'|'manager'|'employee'; language: 'en'|'ar' };
const newUser = (role: UserDraft['role'] = 'employee'): UserDraft => ({ email: '', firstName: '', lastName: '', jobTitle: '', department: role === 'owner' ? 'Management' : '', role, language: 'en' });
const RECOVERY_KEY = 'brain:first-customer-onboarding-v1';

async function recoveryIdempotencyKey(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  try {
    const stored = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? 'null') as { digest?: unknown; key?: unknown } | null;
    if (stored?.digest === digest && typeof stored.key === 'string' && /^[0-9a-f-]{36}$/i.test(stored.key)) return stored.key;
  } catch { /* Replace a malformed recovery marker. */ }
  const key = crypto.randomUUID();
  sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ digest, key }));
  return key;
}

const copy = {
  en: { title: 'Provision first customer', help: 'Creates an isolated company, first location, employee records, and invited user profiles only after explicit confirmation.', company: 'Company', location: 'First location', team: 'Initial staff', add: 'Add staff member', remove: 'Remove', confirm: 'I confirm these invitation emails may be sent.', submit: 'Provision tenant and send invitations', busy: 'Provisioning…', done: 'Tenant provisioned and invitations recorded.', failed: 'Provisioning did not complete. No success was claimed; retry with the same form.', name: 'Name', industry: 'Industry', country: 'Country', currency: 'Currency', timezone: 'Timezone', type: 'Type', city: 'City', address: 'Address', first: 'First name', last: 'Last name', email: 'Email', job: 'Job title', department: 'Department', role: 'Access role', language: 'Language' },
  ar: { title: 'تجهيز العميل الأول', help: 'ينشئ شركة معزولة وموقعها الأول وسجلات الموظفين وحساباتهم المدعوة بعد التأكيد الصريح فقط.', company: 'الشركة', location: 'الموقع الأول', team: 'فريق العمل الأولي', add: 'إضافة موظف', remove: 'إزالة', confirm: 'أؤكد السماح بإرسال رسائل الدعوة هذه.', submit: 'تجهيز الشركة وإرسال الدعوات', busy: 'جارٍ التجهيز…', done: 'تم تجهيز الشركة وتسجيل الدعوات.', failed: 'لم يكتمل التجهيز ولم يتم إعلان النجاح. أعد المحاولة بالنموذج نفسه.', name: 'الاسم', industry: 'القطاع', country: 'الدولة', currency: 'العملة', timezone: 'المنطقة الزمنية', type: 'النوع', city: 'المدينة', address: 'العنوان', first: 'الاسم الأول', last: 'اسم العائلة', email: 'البريد الإلكتروني', job: 'المسمى الوظيفي', department: 'القسم', role: 'صلاحية الوصول', language: 'اللغة' },
};

export default function CustomerOnboardingForm() {
  const { language } = useLocale();
  const t = copy[language];
  const [company, setCompany] = useState({ companyName: '', industry: 'hospitality', country: 'Lebanon', currency: 'USD', timezone: 'Asia/Beirut' });
  const [location, setLocation] = useState({ name: '', type: 'restaurant', city: '', address: '' });
  const [users, setUsers] = useState<UserDraft[]>([newUser('owner')]);
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<'idle'|'busy'|'done'|'failed'>('idle');
  const idempotencyKey = useRef<string | null>(null);
  const updateUser = (index: number, field: keyof UserDraft, value: string) => setUsers((current) => current.map((user, item) => item === index ? { ...user, [field]: value } as UserDraft : user));
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || state === 'busy') return;
    setState('busy');
    const payload = { ...company, location, users };
    idempotencyKey.current = await recoveryIdempotencyKey(payload);
    try {
      const response = await fetch('/api/onboarding/customers', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey.current }, body: JSON.stringify({ confirmed: true, payload }) });
      if (!response.ok) throw new Error('failed');
      sessionStorage.removeItem(RECOVERY_KEY);
      setState('done');
    } catch { setState('failed'); }
  }
  const input = 'brain-input min-w-0';
  return <form onSubmit={submit} className="space-y-6" dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header><h1 className="text-3xl font-bold text-slate-950">{t.title}</h1><p className="mt-2 max-w-3xl text-slate-600">{t.help}</p></header>
    <fieldset className="brain-surface grid gap-4 p-5 sm:grid-cols-2"><legend className="px-2 font-semibold">{t.company}</legend>
      {(['companyName','industry','country','currency','timezone'] as const).map((field) => <label key={field} className="text-sm text-slate-700"><span className="mb-1 block">{field === 'companyName' ? t.name : t[field]}</span><input required className={input} value={company[field]} onChange={(e) => setCompany({ ...company, [field]: e.target.value })} /></label>)}
    </fieldset>
    <fieldset className="brain-surface grid gap-4 p-5 sm:grid-cols-2"><legend className="px-2 font-semibold">{t.location}</legend>
      {(['name','type','city','address'] as const).map((field) => <label key={field} className="text-sm text-slate-700"><span className="mb-1 block">{t[field]}</span><input required={field !== 'address'} className={input} value={location[field]} onChange={(e) => setLocation({ ...location, [field]: e.target.value })} /></label>)}
    </fieldset>
    <fieldset className="space-y-4"><legend className="font-semibold text-slate-950">{t.team}</legend>{users.map((user, index) => <div key={index} className="brain-surface grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
      {(['firstName','lastName','email','jobTitle','department'] as const).map((field) => <label key={field} className="text-sm"><span className="mb-1 block text-slate-700">{{firstName:t.first,lastName:t.last,email:t.email,jobTitle:t.job,department:t.department}[field]}</span><input required type={field === 'email' ? 'email' : 'text'} className={input} value={user[field]} onChange={(e) => updateUser(index, field, e.target.value)} /></label>)}
      <label className="text-sm"><span className="mb-1 block text-slate-700">{t.role}</span><select className={input} value={user.role} onChange={(e) => updateUser(index,'role',e.target.value)}><option value="owner">owner</option><option value="manager">manager</option><option value="employee">employee</option></select></label>
      <label className="text-sm"><span className="mb-1 block text-slate-700">{t.language}</span><select className={input} value={user.language} onChange={(e) => updateUser(index,'language',e.target.value)}><option value="en">English</option><option value="ar">العربية</option></select></label>
      {index > 0 ? <button type="button" className="brain-button-secondary self-end" onClick={() => setUsers((current) => current.filter((_, item) => item !== index))}>{t.remove}</button> : null}
    </div>)}<button type="button" className="brain-button-secondary" onClick={() => setUsers((current) => [...current,newUser()])}>{t.add}</button></fieldset>
    <label className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />{t.confirm}</label>
    {state === 'done' ? <p role="status" className="text-emerald-700">{t.done}</p> : null}{state === 'failed' ? <p role="alert" className="text-red-700">{t.failed}</p> : null}
    <button disabled={!confirmed || state === 'busy' || state === 'done'} className="brain-button-primary" type="submit">{state === 'busy' ? t.busy : t.submit}</button>
  </form>;
}
