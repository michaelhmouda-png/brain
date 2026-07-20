import type { SupabaseClient } from '@supabase/supabase-js';

import { createServerOutboxDomainEventRecorder } from '../../events/infrastructure/record-domain-event.server.ts';
import { createTaskCommandHandler } from '../commands/create-task-command-handler.ts';
import { createSupabaseTaskRecordDependencies } from '../infrastructure/create-task-record.server.ts';
import {
  createCreateTaskApplicationService,
  type CreateTaskApplicationService,
} from './create-task-application-service.ts';

export function createSupabaseCreateTaskApplicationService(
  supabase: SupabaseClient,
): CreateTaskApplicationService {
  const handler = createTaskCommandHandler(
    createSupabaseTaskRecordDependencies(supabase),
    createServerOutboxDomainEventRecorder(),
  );
  return createCreateTaskApplicationService({ handler });
}
