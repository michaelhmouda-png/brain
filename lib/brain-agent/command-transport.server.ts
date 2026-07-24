import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeviceCommandEnqueue } from './command-contracts';

export type EnqueuedDeviceCommand = {
  commandId: string;
  status: string;
  expiresAt: string;
  duplicateRequest: boolean;
};

export type DeviceCommandView = {
  commandId: string;
  commandType: string;
  status: string;
  attemptCount: number;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
};

export async function enqueueDeviceCommand(
  client: SupabaseClient,
  input: DeviceCommandEnqueue,
): Promise<EnqueuedDeviceCommand | null> {
  const { data, error } = await client.rpc('enqueue_device_command', {
    p_gateway_id: input.gatewayId,
    p_nvr_connection_id: input.nvrConnectionId,
    p_command_type: input.commandType,
    p_idempotency_key: input.idempotencyKey,
    p_request_payload: input.request,
    p_ttl_seconds: input.ttlSeconds,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;
  return {
    commandId: row.command_id,
    status: row.command_status,
    expiresAt: row.command_expires_at,
    duplicateRequest: row.duplicate_request === true,
  };
}

export async function readDeviceCommand(
  client: SupabaseClient,
  commandId: string,
): Promise<{ unavailable: boolean; command: DeviceCommandView | null }> {
  const { data, error } = await client.rpc('get_device_command', { p_command_id: commandId });
  if (error) return { unavailable: true, command: null };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { unavailable: false, command: null };
  return {
    unavailable: false,
    command: {
      commandId: row.command_id,
      commandType: row.command_type,
      status: row.command_status,
      attemptCount: row.attempt_count,
      result: row.result_payload,
      errorCode: row.error_code,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      completedAt: row.completed_at,
    },
  };
}
