export const DEVICE_COMMAND_TYPES = [
  'agent_health',
  'network_reachability',
  'nvr_capability_probe',
  'channel_discovery',
  'snapshot_request',
] as const;

export const DEVICE_COMMAND_TRANSPORT_CAPABILITY = 'brain.command.transport.v1' as const;

export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];
export type DeviceCommandStatus = 'pending' | 'leased' | 'succeeded' | 'failed' | 'expired';
export type DeviceCommandOutcome = 'succeeded' | 'failed';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,79}$/;
const CHANNEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;
const PORT_KINDS = ['http', 'rtsp', 'onvif'] as const;

type JsonObject = Record<string, unknown>;

export type DeviceCommandEnqueue = {
  gatewayId: string;
  nvrConnectionId: string | null;
  commandType: DeviceCommandType;
  idempotencyKey: string;
  request: JsonObject;
  ttlSeconds: number;
};

export type ClaimedDeviceCommand = {
  commandId: string;
  commandType: DeviceCommandType;
  nvrConnectionId: string | null;
  request: JsonObject;
  target: {
    vendor: string;
    localHost: string;
    httpPort: number | null;
    rtspPort: number | null;
    onvifPort: number | null;
  } | null;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptNumber: number;
  commandExpiresAt: string;
};

export type AgentCommandCompletion = {
  commandId: string;
  commandType: DeviceCommandType;
  leaseToken: string;
  outcome: DeviceCommandOutcome;
  result: JsonObject;
  errorCode: string | null;
  retryable: boolean;
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function isCommandType(value: unknown): value is DeviceCommandType {
  return typeof value === 'string' && DEVICE_COMMAND_TYPES.includes(value as DeviceCommandType);
}

export function validDeviceCommandRequest(commandType: DeviceCommandType, value: unknown): value is JsonObject {
  const request = object(value);
  if (!request) return false;
  if (commandType === 'network_reachability') {
    return exactKeys(request, ['portKind', 'timeoutMs'])
      && PORT_KINDS.includes(request.portKind as (typeof PORT_KINDS)[number])
      && integer(request.timeoutMs, 250, 10_000);
  }
  if (commandType === 'snapshot_request') {
    return exactKeys(request, ['channelId'])
      && typeof request.channelId === 'string'
      && CHANNEL_ID.test(request.channelId);
  }
  return exactKeys(request, []);
}

export function parseDeviceCommandEnqueue(value: unknown): DeviceCommandEnqueue | null {
  const body = object(value);
  if (!body || !isUuid(body.gatewayId) || !isUuid(body.idempotencyKey) || !isCommandType(body.commandType)) return null;
  const nvrConnectionId = body.nvrConnectionId == null ? null : isUuid(body.nvrConnectionId) ? body.nvrConnectionId : undefined;
  const ttlSeconds = body.ttlSeconds === undefined ? 120 : body.ttlSeconds;
  if (nvrConnectionId === undefined || !integer(ttlSeconds, 30, 600) || !validDeviceCommandRequest(body.commandType, body.request)) return null;
  if (body.commandType === 'agent_health' ? nvrConnectionId !== null : nvrConnectionId === null) return null;
  return {
    gatewayId: body.gatewayId,
    nvrConnectionId,
    commandType: body.commandType,
    idempotencyKey: body.idempotencyKey,
    request: body.request as JsonObject,
    ttlSeconds,
  };
}

export function validDeviceCommandResult(commandType: DeviceCommandType, value: unknown): value is JsonObject {
  const result = object(value);
  if (!result) return false;
  if (commandType === 'agent_health') {
    return exactKeys(result, ['agentVersion', 'platform', 'uptimeSeconds'])
      && boundedString(result.agentVersion, 80)
      && boundedString(result.platform, 40)
      && integer(result.uptimeSeconds, 0, 31_536_000);
  }
  if (commandType === 'network_reachability') {
    return exactKeys(result, ['latencyMs', 'portKind', 'reachable'])
      && typeof result.reachable === 'boolean'
      && PORT_KINDS.includes(result.portKind as (typeof PORT_KINDS)[number])
      && integer(result.latencyMs, 0, 60_000);
  }
  if (commandType === 'nvr_capability_probe') {
    return exactKeys(result, ['capabilities', 'vendor'])
      && boundedString(result.vendor, 80)
      && Array.isArray(result.capabilities)
      && result.capabilities.length <= 64
      && result.capabilities.every((item) => boundedString(item, 80) && /^[a-z][a-z0-9_.-]{1,79}$/.test(item));
  }
  if (commandType === 'channel_discovery') {
    return exactKeys(result, ['channels'])
      && Array.isArray(result.channels)
      && result.channels.length <= 256
      && result.channels.every((item) => {
        const channel = object(item);
        return Boolean(channel)
          && exactKeys(channel!, ['enabled', 'externalChannelId', 'name'])
          && typeof channel!.enabled === 'boolean'
          && typeof channel!.externalChannelId === 'string'
          && CHANNEL_ID.test(channel!.externalChannelId)
          && boundedString(channel!.name, 120);
      });
  }
  return exactKeys(result, ['artifactId', 'capturedAt', 'contentType'])
    && isUuid(result.artifactId)
    && typeof result.contentType === 'string'
    && ['image/jpeg', 'image/webp'].includes(result.contentType)
    && boundedString(result.capturedAt, 40);
}

export function parseAgentCommandCompletion(value: unknown): AgentCommandCompletion | null {
  const body = object(value);
  if (!body || !isUuid(body.commandId) || !isUuid(body.leaseToken) || !isCommandType(body.commandType)) return null;
  if (body.outcome !== 'succeeded' && body.outcome !== 'failed') return null;
  if (typeof body.retryable !== 'boolean') return null;
  const result = object(body.result);
  const errorCode = body.errorCode == null ? null : typeof body.errorCode === 'string' && SAFE_CODE.test(body.errorCode) ? body.errorCode : undefined;
  if (!result || errorCode === undefined) return null;
  if (body.outcome === 'succeeded') {
    if (body.retryable || errorCode !== null || !validDeviceCommandResult(body.commandType, result)) return null;
  } else if (!exactKeys(result, []) || errorCode === null) {
    return null;
  }
  return {
    commandId: body.commandId,
    commandType: body.commandType,
    leaseToken: body.leaseToken,
    outcome: body.outcome,
    result,
    errorCode,
    retryable: body.retryable,
  };
}

export function parseClaimedDeviceCommands(value: unknown): ClaimedDeviceCommand[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const commands: ClaimedDeviceCommand[] = [];
  for (const candidate of value) {
    const row = object(candidate);
    if (!row || !isUuid(row.commandId) || !isCommandType(row.commandType) || !isUuid(row.leaseToken)) return null;
    const nvrConnectionId = row.nvrConnectionId == null ? null : isUuid(row.nvrConnectionId) ? row.nvrConnectionId : undefined;
    const request = object(row.request);
    const rawTarget = row.target == null ? null : object(row.target);
    const target = rawTarget && exactKeys(rawTarget, ['vendor', 'localHost', 'httpPort', 'rtspPort', 'onvifPort'])
      && boundedString(rawTarget.vendor, 80) && boundedString(rawTarget.localHost, 255)
      && (rawTarget.httpPort === null || integer(rawTarget.httpPort, 1, 65_535))
      && (rawTarget.rtspPort === null || integer(rawTarget.rtspPort, 1, 65_535))
      && (rawTarget.onvifPort === null || integer(rawTarget.onvifPort, 1, 65_535))
      ? {
          vendor: rawTarget.vendor as string,
          localHost: rawTarget.localHost as string,
          httpPort: rawTarget.httpPort as number | null,
          rtspPort: rawTarget.rtspPort as number | null,
          onvifPort: rawTarget.onvifPort as number | null,
        }
      : rawTarget === null ? null : undefined;
    if (nvrConnectionId === undefined || !request || target === undefined || !validDeviceCommandRequest(row.commandType, request)) return null;
    if (row.commandType === 'agent_health' ? target !== null || nvrConnectionId !== null : target === null || nvrConnectionId === null) return null;
    if (!boundedString(row.leaseExpiresAt, 40) || !integer(row.attemptNumber, 1, 10) || !boundedString(row.commandExpiresAt, 40)) return null;
    commands.push({
      commandId: row.commandId,
      commandType: row.commandType,
      nvrConnectionId,
      request,
      target,
      leaseToken: row.leaseToken,
      leaseExpiresAt: row.leaseExpiresAt,
      attemptNumber: row.attemptNumber,
      commandExpiresAt: row.commandExpiresAt,
    });
  }
  return commands;
}
