import webPush from 'web-push';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { enqueueLegacyTaskLocalizationBatch, processOneTaskLocalization } from '@/lib/task-localization.server';
import { processRecurringTaskWork } from '@/lib/recurring-tasks/service.server';

type Claim = { job_id: string; lease_token: string; endpoint: string; p256dh: string; auth_key: string; notification_id: string; title: string; summary: string; route: string };

function first(value: unknown): Record<string, unknown> | null {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === 'object' && item !== null && !Array.isArray(item) ? item as Record<string, unknown> : null;
}

function claim(value: unknown): Claim | null {
  const result = first(value);
  if (!result || !['job_id', 'lease_token', 'endpoint', 'p256dh', 'auth_key', 'notification_id', 'title', 'summary', 'route']
    .every((key) => typeof result[key] === 'string')) return null;
  return result as unknown as Claim;
}

async function enqueueLegacyLocalizationWork(service: ReturnType<typeof createSupabaseServer>) {
  console.info('[Task Localization]', { operation: 'backfill.batch_started', batchLimit: 25 });
  try {
    const result = await enqueueLegacyTaskLocalizationBatch(service, 25);
    if (result.enqueued > 0) console.info('[Task Localization]', { operation: 'backfill.job_enqueued', count: result.enqueued });
    if (result.alreadyCurrent > 0) console.info('[Task Localization]', { operation: 'backfill.already_current', count: result.alreadyCurrent });
    if (result.alreadyQueued > 0) console.info('[Task Localization]', { operation: 'backfill.already_queued', count: result.alreadyQueued });
    if (result.unresolved > 0) console.warn('[Task Localization]', { operation: 'backfill.recipient_unresolved', count: result.unresolved });
    console.info('[Task Localization]', { operation: 'backfill.batch_completed', ...result });
  } catch (error) {
    console.warn('[Task Localization]', {
      operation: 'backfill.batch_completed',
      outcome: 'failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

async function processLocalizationAfterNotifications(supabase: ReturnType<typeof createSupabaseServer>) {
  await enqueueLegacyLocalizationWork(supabase);
  try {
    await processOneTaskLocalization(supabase);
  } catch (error) {
    console.warn('[Notification Worker] task localization unavailable', {
      stage: 'task.localization.process',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

async function processRecurringAfterNotifications(supabase: ReturnType<typeof createSupabaseServer>) {
  try {
    await processRecurringTaskWork(supabase);
  } catch (error) {
    console.warn('[Notification Worker] recurring task work unavailable', {
      stage: 'recurring_tasks.materialize',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
  }
}

export async function processNotificationWork() {
  const supabase = createSupabaseServer();
  await supabase.rpc('generate_task_reminder_obligations');
  const { data: outbox } = await supabase.rpc('claim_notification_outbox', { p_lease_seconds: 120 });
  const obligation = first(outbox);
  if (obligation && typeof obligation.outbox_id === 'string' && typeof obligation.lease_token === 'string') {
    const { data: recurringData, error: recurringError } = await supabase.rpc('materialize_recurring_task_outbox', {
      p_outbox_id: obligation.outbox_id,
      p_lease_token: obligation.lease_token,
    });
    const recurringResult = first(recurringData);
    const recurringHandled = recurringResult?.handled === true;
    const { data: inventoryData, error: inventoryError } = recurringError || recurringHandled
      ? { data: null, error: null }
      : await supabase.rpc('materialize_inventory_low_stock_outbox', {
        p_outbox_id: obligation.outbox_id,
        p_lease_token: obligation.lease_token,
      });
    const inventoryResult = first(inventoryData);
    const inventoryHandled = inventoryResult?.handled === true;
    const { error: standardError } = inventoryError || inventoryHandled
      ? { error: null }
      : await supabase.rpc('materialize_notification_outbox', {
        p_outbox_id: obligation.outbox_id,
        p_lease_token: obligation.lease_token,
      });
    const error = recurringError ?? inventoryError ?? standardError;
    if (error) await supabase.rpc('fail_notification_outbox', {
      p_outbox_id: obligation.outbox_id,
      p_lease_token: obligation.lease_token,
      p_code: error.code ?? 'MATERIALIZE_FAILED',
    });
  }

  const { data } = await supabase.rpc('claim_notification_delivery', { p_lease_seconds: 120 });
  const job = claim(data);
  if (!job) {
    await processLocalizationAfterNotifications(supabase);
    await processRecurringAfterNotifications(supabase);
    return obligation ? 'materialized' : 'idle';
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) throw new Error('VAPID_CONFIGURATION_MISSING');
  webPush.setVapidDetails(subject, publicKey, privateKey);

  let result: 'delivered' | 'revoked' | 'retry';
  try {
    await webPush.sendNotification({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth_key } }, JSON.stringify({title:job.title,summary:job.summary,notificationId:job.notification_id,route:job.route}), { TTL: 300, urgency: 'normal' });
    const { error: completionError } = await supabase.rpc('complete_notification_delivery', {
      p_job_id: job.job_id, p_lease_token: job.lease_token,
    });
    if (completionError) {
      console.warn('[Notification Worker] provider accepted but completion persistence failed', {
        stage: 'notification.delivery.complete', jobId:job.job_id,notificationId:job.notification_id,errorCode: completionError.code ?? 'DELIVERY_COMPLETION_FAILED',
      });
      throw new Error('DELIVERY_COMPLETION_FAILED');
    }
    result = 'delivered';
  } catch (error) {
    const status = typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode : 0;
    const permanent = status===404||status===410;
    await supabase.rpc('fail_notification_delivery', {
      p_job_id: job.job_id, p_lease_token: job.lease_token,
      p_code: permanent ? 'SUBSCRIPTION_EXPIRED' : 'PUSH_DELIVERY_FAILED', p_permanent: permanent,
    });
    result = permanent ? 'revoked' : 'retry';
  }

  await processLocalizationAfterNotifications(supabase);
  await processRecurringAfterNotifications(supabase);
  return result;
}
