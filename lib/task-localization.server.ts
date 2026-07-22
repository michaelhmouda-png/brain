import 'server-only';

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServer } from '@/lib/supabaseServer';
import {
  TaskTranslationError,
  translateAuthorizedTaskRecords,
} from '@/lib/brain/employee-task-presentation.server';

export type TaskTranslationState = 'not_required' | 'ready' | 'pending' | 'failed';
export type TaskDisplayLocalization = {
  displayTitle: string | null;
  displayDescription: string | null;
  translationState: TaskTranslationState;
};

type CanonicalTask = { id: string; title: string; description: string | null };

function sourceHash(task: CanonicalTask): string {
  return createHash('sha256').update(`${task.title}\n${task.description ?? ''}`, 'utf8').digest('hex');
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null && !Array.isArray(row))
    : [];
}

export async function loadTaskDisplayLocalizations(input: {
  companyId: string;
  language: 'en' | 'ar';
  tasks: readonly CanonicalTask[];
  service?: SupabaseClient;
}): Promise<Map<string, TaskDisplayLocalization>> {
  if (input.language === 'en') return new Map(input.tasks.map((task) => [task.id, {
    displayTitle: task.title, displayDescription: task.description, translationState: 'not_required',
  }]));
  if (input.tasks.length === 0) return new Map();
  const service = input.service ?? createSupabaseServer();
  const ids = input.tasks.map((task) => task.id);
  const [{ data: localized, error: localizedError }, { data: jobs, error: jobsError }] = await Promise.all([
    service.from('task_localizations').select('task_id,source_hash,title,description').eq('company_id', input.companyId).eq('language', 'ar').in('task_id', ids),
    service.from('task_localization_jobs').select('task_id,status').eq('company_id', input.companyId).eq('language', 'ar').in('task_id', ids),
  ]);
  if (localizedError || jobsError) throw new Error('TASK_LOCALIZATION_QUERY_FAILED');
  const expectedHashes = new Map(input.tasks.map((task) => [task.id, sourceHash(task)]));
  const translations = new Map(records(localized).flatMap((row) =>
    typeof row.task_id === 'string' && typeof row.title === 'string'
      && typeof row.source_hash === 'string' && expectedHashes.get(row.task_id) === row.source_hash
      ? [[row.task_id, { title: row.title, description: typeof row.description === 'string' ? row.description : null }] as const]
      : []));
  const states = new Map(records(jobs).flatMap((row) =>
    typeof row.task_id === 'string' && typeof row.status === 'string' ? [[row.task_id, row.status] as const] : []));
  return new Map(input.tasks.map((task) => {
    const translated = translations.get(task.id);
    return [task.id, translated ? {
      displayTitle: translated.title,
      displayDescription: translated.description,
      translationState: 'ready' as const,
    } : {
      displayTitle: null,
      displayDescription: null,
      translationState: states.get(task.id) === 'failed' ? 'failed' as const : 'pending' as const,
    }];
  }));
}

export async function processOneTaskLocalization(service: SupabaseClient = createSupabaseServer()): Promise<'idle' | 'completed' | 'retry'> {
  const { data, error } = await service.rpc('claim_task_localization_job', { p_lease_seconds: 120 });
  if (error) throw new Error('TASK_LOCALIZATION_CLAIM_FAILED');
  const job = records(data)[0];
  if (!job) return 'idle';
  const required = ['task_id', 'company_id', 'language', 'source_hash', 'title', 'lease_token'] as const;
  if (!required.every((field) => typeof job[field] === 'string') || job.language !== 'ar') throw new Error('TASK_LOCALIZATION_JOB_INVALID');
  try {
    const translated = await translateAuthorizedTaskRecords([{
      id: job.task_id as string,
      originalTitle: job.title as string,
      originalDescription: typeof job.description === 'string' ? job.description : null,
    }], 'ar', { apiKey: process.env.OPENAI_API_KEY });
    const value = translated.get(job.task_id as string);
    if (!value) throw new TaskTranslationError('validate');
    const { error: completeError } = await service.rpc('complete_task_localization_job', {
      p_task_id: job.task_id, p_language: 'ar', p_source_hash: job.source_hash,
      p_lease_token: job.lease_token, p_title: value.title, p_description: value.description,
    });
    if (completeError) throw new Error('TASK_LOCALIZATION_COMPLETE_FAILED');
    return 'completed';
  } catch (failure) {
    const code = failure instanceof TaskTranslationError ? `TRANSLATION_${failure.stage.toUpperCase()}` : 'TRANSLATION_FAILED';
    await service.rpc('fail_task_localization_job', {
      p_task_id: job.task_id, p_language: 'ar', p_lease_token: job.lease_token, p_code: code,
    });
    return 'retry';
  }
}
