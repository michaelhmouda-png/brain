import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActorContext } from '@/lib/brain/kernel/actor-context';
import {
  employeeCoachOutputIsSafe,
  type EmployeeCoachLanguage,
} from '@/lib/brain/employee-coach';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const DAY_LABELS = {
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  ar: ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'],
} as const;

export class EmployeeCoachDataError extends Error {
  constructor(readonly code: 'EMPLOYEE_LINK_MISSING' | 'SCHEDULE_UNAVAILABLE' | 'NOTIFICATIONS_UNAVAILABLE') {
    super(code);
    this.name = 'EmployeeCoachDataError';
  }
}

function dateAtTimezone(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function moveDate(date: string, offset: number): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function mondayFor(date: string): string {
  const value = new Date(`${date}T12:00:00.000Z`);
  const day = value.getUTCDay();
  return moveDate(date, -(day === 0 ? 6 : day - 1));
}

async function companyTimezone(supabase: SupabaseClient, companyId: string): Promise<string> {
  const { data, error } = await supabase
    .from('companies')
    .select('timezone')
    .eq('id', companyId)
    .maybeSingle();
  if (error || typeof data?.timezone !== 'string' || !data.timezone) {
    throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: data.timezone }).format();
  } catch {
    throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
  }
  return data.timezone;
}

export async function loadOwnScheduleForCoach(input: {
  supabase: SupabaseClient;
  actor: ActorContext;
  language: EmployeeCoachLanguage;
  now?: Date;
}): Promise<string> {
  if (!input.actor.employeeId) throw new EmployeeCoachDataError('EMPLOYEE_LINK_MISSING');
  const timezone = await companyTimezone(input.supabase, input.actor.companyId);
  const weekStart = mondayFor(dateAtTimezone(input.now ?? new Date(), timezone));
  const { data: schedule, error: scheduleError } = await input.supabase
    .from('weekly_schedules')
    .select('monday_shift_id,tuesday_shift_id,wednesday_shift_id,thursday_shift_id,friday_shift_id,saturday_shift_id,sunday_shift_id')
    .eq('company_id', input.actor.companyId)
    .eq('employee_id', input.actor.employeeId)
    .eq('week_start_date', weekStart)
    .maybeSingle();
  if (scheduleError) throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');

  const heading = input.language === 'ar'
    ? `جدولك للأسبوع الذي يبدأ ${weekStart}:`
    : `Your schedule for the week starting ${weekStart}:`;
  if (!schedule) {
    const output = input.language === 'ar'
      ? `${heading}\nلا توجد ورديات مسجّلة لهذا الأسبوع.`
      : `${heading}\nNo shifts are recorded for this week.`;
    if (!employeeCoachOutputIsSafe(output, 'none')) throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
    return output;
  }

  const templateIds = [...new Set(DAYS.flatMap((day) => {
    const value = schedule[`${day}_shift_id`];
    return typeof value === 'string' ? [value] : [];
  }))];
  const { data: templates, error: templateError } = templateIds.length
    ? await input.supabase
        .from('shift_templates')
        .select('id,name,start_time,end_time')
        .eq('company_id', input.actor.companyId)
        .in('id', templateIds)
    : { data: [], error: null };
  if (templateError) throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
  const byId = new Map((templates ?? []).map((template) => [template.id, template]));
  const lines = DAYS.flatMap((day, index) => {
    const templateId = schedule[`${day}_shift_id`];
    const template = typeof templateId === 'string' ? byId.get(templateId) : null;
    if (!template) return [];
    const name = typeof template.name === 'string' ? template.name : '';
    const start = typeof template.start_time === 'string' ? template.start_time.slice(0, 5) : '';
    const end = typeof template.end_time === 'string' ? template.end_time.slice(0, 5) : '';
    if (!start || !end) throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
    return [`- ${DAY_LABELS[input.language][index]}: ${start}-${end}${name ? ` - ${name}` : ''}`];
  });
  if (lines.length === 0) {
    const output = input.language === 'ar'
      ? `${heading}\nلا توجد ورديات مسجّلة لهذا الأسبوع.`
      : `${heading}\nNo shifts are recorded for this week.`;
    if (!employeeCoachOutputIsSafe(output, 'none')) throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
    return output;
  }
  const output = [heading, ...lines].join('\n');
  if (!employeeCoachOutputIsSafe(output, 'none')) throw new EmployeeCoachDataError('SCHEDULE_UNAVAILABLE');
  return output;
}

function notificationRow(value: unknown): { title: string; message: string; unread: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.title !== 'string' || typeof row.message !== 'string') return null;
  return { title: row.title, message: row.message, unread: row.status === 'unread' };
}

export async function loadOwnNotificationsForCoach(input: {
  supabase: SupabaseClient;
  language: EmployeeCoachLanguage;
}): Promise<string> {
  const { data, error } = await input.supabase.rpc('list_my_notifications', {
    p_limit: 10,
    p_before: null,
  });
  if (error || !Array.isArray(data)) throw new EmployeeCoachDataError('NOTIFICATIONS_UNAVAILABLE');
  const notifications = data.map(notificationRow);
  if (notifications.some((item) => item === null)) throw new EmployeeCoachDataError('NOTIFICATIONS_UNAVAILABLE');
  const safeRows = notifications.filter((item): item is NonNullable<typeof item> => item !== null);
  if (safeRows.length === 0) {
    const output = input.language === 'ar' ? 'لا توجد إشعارات حالية.' : 'You have no current notifications.';
    if (!employeeCoachOutputIsSafe(output, 'none')) throw new EmployeeCoachDataError('NOTIFICATIONS_UNAVAILABLE');
    return output;
  }
  const unread = safeRows.filter((item) => item.unread).length;
  const heading = input.language === 'ar'
    ? `لديك ${unread} إشعار غير مقروء. أحدث الإشعارات:`
    : `You have ${unread} unread notification${unread === 1 ? '' : 's'}. Latest notifications:`;
  const output = [
    heading,
    ...safeRows.slice(0, 5).map((item) => `- ${item.title}: ${item.message}`),
  ].join('\n');
  if (!employeeCoachOutputIsSafe(output, 'none')) throw new EmployeeCoachDataError('NOTIFICATIONS_UNAVAILABLE');
  return output;
}
