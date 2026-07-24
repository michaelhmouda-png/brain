export const DEVICE_COMMAND_TYPES = [
  'agent_health',
  'network_reachability',
  'nvr_capability_probe',
  'nvr_health_diagnostics',
  'channel_discovery',
  'snapshot_request',
] as const;

export const DEVICE_COMMAND_TRANSPORT_CAPABILITY = 'brain.command.transport.v1' as const;

export type DeviceCommandType = (typeof DEVICE_COMMAND_TYPES)[number];
export type DeviceCommandStatus = 'pending' | 'leased' | 'succeeded' | 'failed' | 'expired';
export type DeviceCommandOutcome = 'succeeded' | 'failed';
export type NvrProbeCommandType = 'nvr_capability_probe' | 'nvr_health_diagnostics';
export const SAFE_NVR_ERROR_CODES = [
  'NETWORK_UNREACHABLE',
  'CONNECTION_REFUSED',
  'CONNECTION_TIMEOUT',
  'TLS_OR_PROTOCOL_MISMATCH',
  'HTTP_UNAUTHORIZED',
  'HTTP_FORBIDDEN',
  'HTTP_NOT_FOUND',
  'DIGEST_AUTH_FAILED',
  'MALFORMED_DAHUA_RESPONSE',
  'RESPONSE_LIMIT_EXCEEDED',
  'NVR_REQUEST_FAILED',
] as const;
export type SafeNvrErrorCode = (typeof SAFE_NVR_ERROR_CODES)[number];
export type SafeDeviceDiagnostic = {
  safeErrorCode: SafeNvrErrorCode;
  httpStatus: number | null;
  operation: 'system_info' | 'current_time' | 'camera_inventory' | 'snapshot';
  responseTimeMs: number;
  requestId: string;
};

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
  diagnostic?: SafeDeviceDiagnostic | null;
};

export type NvrProbeEnqueue = {
  nvrConnectionId: string;
  commandType: NvrProbeCommandType;
  idempotencyKey: string;
  ttlSeconds: number;
};

export type SanitizedNvrProbeCommand = {
  commandId: string;
  requestId: string;
  commandType: NvrProbeCommandType;
  status: DeviceCommandStatus;
  attemptCount: number;
  safeFailureCode: string | null;
  result: JsonObject | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
};

export type SanitizedNvrProbeControlState = {
  nvrConnectionId: string;
  gatewayId: string | null;
  eligible: boolean;
  assignmentCompatible: boolean;
  gatewayOnline: boolean;
  credentialsPresent: boolean;
  safeUnavailableCode: string | null;
  commands: SanitizedNvrProbeCommand[];
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
  if (commandType === 'channel_discovery') {
    return exactKeys(request, []) || exactKeys(request, ['diagnostic']) && request.diagnostic === true;
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

export function parseNvrProbeEnqueue(value: unknown): NvrProbeEnqueue | null {
  const body = object(value);
  if (!body || !exactKeys(body, ['commandType', 'idempotencyKey', 'nvrConnectionId', 'ttlSeconds'])) return null;
  if (!isUuid(body.nvrConnectionId) || !isUuid(body.idempotencyKey)) return null;
  if (body.commandType !== 'nvr_capability_probe' && body.commandType !== 'nvr_health_diagnostics') return null;
  if (!integer(body.ttlSeconds, 30, 600)) return null;
  return {
    nvrConnectionId: body.nvrConnectionId,
    commandType: body.commandType,
    idempotencyKey: body.idempotencyKey,
    ttlSeconds: body.ttlSeconds,
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
    return exactKeys(result, ['latencyMs', 'portKind', 'reachable', 'resolution', 'safeFailureCode'])
      && typeof result.reachable === 'boolean'
      && PORT_KINDS.includes(result.portKind as (typeof PORT_KINDS)[number])
      && integer(result.latencyMs, 0, 60_000)
      && typeof result.resolution === 'string'
      && ['literal_private_ipv4', 'literal_private_ipv6', 'resolved_private_ipv4', 'resolved_private_ipv6'].includes(result.resolution)
      && (result.safeFailureCode === null
        || ['NETWORK_UNREACHABLE', 'CONNECTION_REFUSED', 'CONNECTION_TIMEOUT'].includes(result.safeFailureCode as string))
      && (result.reachable ? result.safeFailureCode === null : result.safeFailureCode !== null);
  }
  if (commandType === 'nvr_capability_probe') {
    return validNvrProbeResult(result);
  }
  if (commandType === 'nvr_health_diagnostics') {
    return validNvrProbeResult(result);
  }
  if (commandType === 'channel_discovery') {
    return exactKeys(result, ['channels', 'diagnostic'])
      && Array.isArray(result.channels)
      && result.channels.length <= 256
      && result.channels.every((item) => {
        const channel = object(item);
        return Boolean(channel)
          && exactKeys(channel!, ['enabled', 'externalChannelId', 'name', 'status'])
          && typeof channel!.enabled === 'boolean'
          && typeof channel!.externalChannelId === 'string'
          && CHANNEL_ID.test(channel!.externalChannelId)
          && boundedString(channel!.name, 120)
          && typeof channel!.status === 'string'
          && ['online', 'offline', 'disabled', 'error'].includes(channel!.status);
      })
      && validChannelDiscoveryDiagnostic(result.diagnostic);
  }
  return exactKeys(result, ['artifactId', 'capturedAt', 'contentType'])
    && isUuid(result.artifactId)
    && typeof result.contentType === 'string'
    && ['image/jpeg', 'image/webp'].includes(result.contentType)
    && boundedString(result.capturedAt, 40);
}

function validChannelDiscoveryDiagnostic(value: unknown): boolean {
  const diagnostic = object(value);
  if (!diagnostic || !exactKeys(diagnostic, [
    'contentType',
    'httpStatus',
    'knownFields',
    'parserBranch',
    'repeatedChannelLikeRecords',
    'requestId',
    'responseByteLength',
    'responseFormat',
    'responseLineCount',
    'responseTimeMs',
    'safeParseFailureCode',
    'sanitizedKeys',
    'sections',
  ])) return false;
  const knownFields = object(diagnostic.knownFields);
  if (!knownFields || !exactKeys(knownFields, [
    'channelName',
    'codec',
    'connectionState',
    'deviceName',
    'enabled',
    'name',
    'resolution',
    'state',
    'uniqueChannel',
  ]) || !Object.values(knownFields).every((flag) => typeof flag === 'boolean')) return false;
  return integer(diagnostic.httpStatus, 100, 599)
    && ['text/plain', 'application/json', 'text/html', 'application/octet-stream', 'unknown'].includes(diagnostic.contentType as string)
    && integer(diagnostic.responseByteLength, 0, 1_048_576)
    && integer(diagnostic.responseLineCount, 0, 1_048_576)
    && ['key_value_lines', 'json', 'xml', 'html', 'unknown_text', 'binary'].includes(diagnostic.responseFormat as string)
    && Array.isArray(diagnostic.sanitizedKeys)
    && diagnostic.sanitizedKeys.length <= 64
    && diagnostic.sanitizedKeys.every((key) => typeof key === 'string'
      && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)
      && !/(?:password|username|address|ip|mac|serial|url|uri|token|credential)/i.test(key))
    && Array.isArray(diagnostic.sections)
    && diagnostic.sections.length <= 16
    && diagnostic.sections.every((section) => typeof section === 'string'
      && ['result[*]', 'camera[*]', 'table.All[*]', 'table.Channel[*]'].includes(section))
    && integer(diagnostic.repeatedChannelLikeRecords, 0, 256)
    && ['result_records_v1', 'camera_records_v1', 'no_supported_records', 'unknown_response'].includes(diagnostic.parserBranch as string)
    && (diagnostic.safeParseFailureCode === null
      || ['NO_SUPPORTED_CHANNEL_RECORDS', 'UNKNOWN_CHANNEL_RESPONSE_FORMAT'].includes(diagnostic.safeParseFailureCode as string))
    && integer(diagnostic.responseTimeMs, 0, 60_000)
    && isUuid(diagnostic.requestId);
}

export function validNvrProbeResult(value: unknown): value is JsonObject {
  const result = object(value);
  return Boolean(result)
      && exactKeys(result!, ['capabilities', 'firmwareVersion', 'healthy', 'model', 'responseTimeMs', 'vendor'])
      && typeof result!.healthy === 'boolean'
      && boundedString(result!.vendor, 80)
      && boundedString(result!.model, 80)
      && boundedString(result!.firmwareVersion, 120)
      && integer(result!.responseTimeMs, 0, 60_000)
      && Array.isArray(result!.capabilities)
      && result!.capabilities.length <= 64
      && result!.capabilities.every((item) => boundedString(item, 80) && /^[a-z][a-z0-9_.-]{1,79}$/.test(item));
}

export function sanitizeNvrProbeResult(value: unknown): JsonObject | null {
  if (!validNvrProbeResult(value)) return null;
  return {
    vendor: value.vendor,
    model: value.model,
    firmwareVersion: value.firmwareVersion,
    capabilities: [...value.capabilities as string[]],
    healthy: value.healthy,
    responseTimeMs: value.responseTimeMs,
  };
}

export function sanitizeNvrProbeControlState(value: unknown): SanitizedNvrProbeControlState | null {
  const state = object(value);
  if (!state || !isUuid(state.nvrConnectionId)) return null;
  const gatewayId = state.gatewayId === null ? null : isUuid(state.gatewayId) ? state.gatewayId : undefined;
  const safeUnavailableCode = state.safeUnavailableCode === null
    ? null
    : typeof state.safeUnavailableCode === 'string' && SAFE_CODE.test(state.safeUnavailableCode)
      ? state.safeUnavailableCode
      : undefined;
  if (gatewayId === undefined
      || typeof state.eligible !== 'boolean'
      || typeof state.assignmentCompatible !== 'boolean'
      || typeof state.gatewayOnline !== 'boolean'
      || typeof state.credentialsPresent !== 'boolean'
      || safeUnavailableCode === undefined
      || !Array.isArray(state.commands)
      || state.commands.length > 2) return null;
  const statuses: DeviceCommandStatus[] = ['pending', 'leased', 'succeeded', 'failed', 'expired'];
  const commands: SanitizedNvrProbeCommand[] = [];
  for (const candidate of state.commands) {
    const command = object(candidate);
    if (!command
        || !isUuid(command.commandId)
        || command.requestId !== command.commandId
        || (command.commandType !== 'nvr_capability_probe' && command.commandType !== 'nvr_health_diagnostics')
        || typeof command.status !== 'string'
        || !statuses.includes(command.status as DeviceCommandStatus)
        || !integer(command.attemptCount, 0, 5)
        || !boundedString(command.createdAt, 40)
        || !boundedString(command.expiresAt, 40)
        || !(command.completedAt === null || boundedString(command.completedAt, 40))
        || !(command.safeFailureCode === null || typeof command.safeFailureCode === 'string' && SAFE_CODE.test(command.safeFailureCode))) {
      return null;
    }
    const result = command.result === null ? null : sanitizeNvrProbeResult(command.result);
    if (command.result !== null && result === null) return null;
    commands.push({
      commandId: command.commandId,
      requestId: command.commandId,
      commandType: command.commandType,
      status: command.status as DeviceCommandStatus,
      attemptCount: command.attemptCount,
      safeFailureCode: command.safeFailureCode as string | null,
      result,
      createdAt: command.createdAt,
      expiresAt: command.expiresAt,
      completedAt: command.completedAt as string | null,
    });
  }
  return {
    nvrConnectionId: state.nvrConnectionId,
    gatewayId,
    eligible: state.eligible,
    assignmentCompatible: state.assignmentCompatible,
    gatewayOnline: state.gatewayOnline,
    credentialsPresent: state.credentialsPresent,
    safeUnavailableCode,
    commands,
  };
}

export function parseAgentCommandCompletion(value: unknown): AgentCommandCompletion | null {
  const body = object(value);
  if (!body || !isUuid(body.commandId) || !isUuid(body.leaseToken) || !isCommandType(body.commandType)) return null;
  if (body.outcome !== 'succeeded' && body.outcome !== 'failed') return null;
  if (typeof body.retryable !== 'boolean') return null;
  const result = object(body.result);
  const errorCode = body.errorCode == null ? null : typeof body.errorCode === 'string' && SAFE_CODE.test(body.errorCode) ? body.errorCode : undefined;
  const rawDiagnostic = body.diagnostic == null ? null : object(body.diagnostic);
  if (!result || errorCode === undefined || (body.diagnostic != null && !rawDiagnostic)) return null;
  let diagnostic: SafeDeviceDiagnostic | null = null;
  if (rawDiagnostic) {
    if (!exactKeys(rawDiagnostic, ['httpStatus', 'operation', 'requestId', 'responseTimeMs', 'safeErrorCode'])
        || !SAFE_NVR_ERROR_CODES.includes(rawDiagnostic.safeErrorCode as SafeNvrErrorCode)
        || rawDiagnostic.safeErrorCode !== errorCode
        || !(rawDiagnostic.httpStatus === null || integer(rawDiagnostic.httpStatus, 100, 599))
        || !['system_info', 'current_time', 'camera_inventory', 'snapshot'].includes(rawDiagnostic.operation as string)
        || !integer(rawDiagnostic.responseTimeMs, 0, 60_000)
        || rawDiagnostic.requestId !== body.commandId) return null;
    diagnostic = rawDiagnostic as SafeDeviceDiagnostic;
  }
  if (body.outcome === 'succeeded') {
    if (body.retryable || errorCode !== null || diagnostic !== null || !validDeviceCommandResult(body.commandType, result)) return null;
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
    diagnostic,
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
