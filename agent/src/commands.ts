import net from 'node:net';
import {
  type AgentCommandCompletion,
  type ClaimedDeviceCommand,
} from '../../lib/brain-agent/command-contracts.ts';
import { AGENT_VERSION } from './constants.ts';
import {
  DahuaAdapter,
  DahuaSafeError,
  type DahuaCredential,
  type DahuaTransport,
} from './dahua-adapter.ts';
import { isPrivateNvrAddress, resolvePrivateNvrAddress } from './network-safety.ts';

class CommandExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

export { isPrivateNvrAddress };
export type ReachabilityFailureCode = 'NETWORK_UNREACHABLE' | 'CONNECTION_REFUSED' | 'CONNECTION_TIMEOUT';

export function classifyNetworkError(error: unknown): ReachabilityFailureCode {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code.toUpperCase()
    : '';
  if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
  if (code === 'ETIMEDOUT') return 'CONNECTION_TIMEOUT';
  return 'NETWORK_UNREACHABLE';
}

export async function checkNetworkReachability(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{
  reachable: boolean;
  latencyMs: number;
  resolution: 'literal_private_ipv4' | 'literal_private_ipv6' | 'resolved_private_ipv4' | 'resolved_private_ipv6';
  safeFailureCode: ReachabilityFailureCode | null;
}> {
  const literal = net.isIP(host) !== 0;
  let target: { address: string; family: 4 | 6 };
  try {
    target = await resolvePrivateNvrAddress(host);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'NVR_DNS_LOOKUP_FAILED';
    throw new CommandExecutionError(code, code !== 'UNSAFE_NVR_ADDRESS');
  }
  const resolution = target.family === 4
    ? literal ? 'literal_private_ipv4' : 'resolved_private_ipv4'
    : literal ? 'literal_private_ipv6' : 'resolved_private_ipv6';
  const started = performance.now();
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: target.address, port, family: target.family });
    let settled = false;
    const finish = (reachable: boolean, safeFailureCode: ReachabilityFailureCode | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        reachable,
        latencyMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
        resolution,
        safeFailureCode,
      });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, null));
    socket.once('timeout', () => finish(false, 'CONNECTION_TIMEOUT'));
    socket.once('error', (error) => finish(false, classifyNetworkError(error)));
  });
}

function failed(
  command: ClaimedDeviceCommand,
  code: string,
  retryable: boolean,
  diagnostic: AgentCommandCompletion['diagnostic'] = null,
): AgentCommandCompletion {
  return {
    commandId: command.commandId,
    commandType: command.commandType,
    leaseToken: command.leaseToken,
    outcome: 'failed',
    result: {},
    errorCode: code,
    retryable,
    diagnostic,
  };
}

export type DeviceCommandExecutionDependencies = {
  credential?: DahuaCredential | null;
  dahuaTransport?: DahuaTransport;
  uploadSnapshot?: (snapshot: {
    bytes: Uint8Array;
    contentType: 'image/jpeg';
    capturedAt: string;
    channelId: string;
    width: number;
    height: number;
  }) => Promise<{ artifactId: string }>;
};

function dahuaFailure(error: unknown): {
  code: string;
  retryable: boolean;
  diagnostic: AgentCommandCompletion['diagnostic'];
} {
  if (error instanceof DahuaSafeError) {
    return {
      code: error.safeCode,
      retryable: error.retryable,
      diagnostic: {
        safeErrorCode: error.safeCode,
        httpStatus: error.httpStatus,
        operation: error.operation,
        responseTimeMs: error.responseTimeMs,
        requestId: '',
      },
    };
  }
  const message = error instanceof Error ? error.message : '';
  if (['DAHUA_AUTHENTICATION_FAILED', 'DAHUA_DIGEST_REQUIRED', 'DAHUA_CREDENTIAL_INVALID'].includes(message)) {
    return { code: 'NVR_AUTHENTICATION_FAILED', retryable: false, diagnostic: null };
  }
  if (['DAHUA_TARGET_INVALID', 'DAHUA_REQUEST_NOT_ALLOWED', 'UNSAFE_NVR_ADDRESS', 'DAHUA_CHANNEL_INVALID'].includes(message)) {
    return { code: 'NVR_TARGET_REJECTED', retryable: false, diagnostic: null };
  }
  if (['DAHUA_RESPONSE_INVALID', 'DAHUA_SNAPSHOT_INVALID', 'DAHUA_RESPONSE_TOO_LARGE'].includes(message)) {
    return { code: 'NVR_RESPONSE_INVALID', retryable: false, diagnostic: null };
  }
  return { code: 'NVR_REQUEST_FAILED', retryable: true, diagnostic: null };
}

export async function executeDeviceCommand(
  command: ClaimedDeviceCommand,
  dependencies: DeviceCommandExecutionDependencies = {},
): Promise<AgentCommandCompletion> {
  if (Date.parse(command.leaseExpiresAt) <= Date.now() + 500 || Date.parse(command.commandExpiresAt) <= Date.now() + 500) {
    return failed(command, 'COMMAND_WINDOW_EXPIRED', true);
  }
  if (command.commandType === 'agent_health') {
    return {
      commandId: command.commandId,
      commandType: command.commandType,
      leaseToken: command.leaseToken,
      outcome: 'succeeded',
      result: {
        agentVersion: AGENT_VERSION,
        platform: process.platform,
        uptimeSeconds: Math.min(31_536_000, Math.max(0, Math.floor(process.uptime()))),
      },
      errorCode: null,
      retryable: false,
    };
  }
  if (command.commandType === 'network_reachability') {
    if (!command.target) return failed(command, 'NVR_TARGET_MISSING', false);
    const portKind = command.request.portKind as 'http' | 'rtsp' | 'onvif';
    const port = portKind === 'http'
      ? command.target.httpPort
      : portKind === 'rtsp'
        ? command.target.rtspPort
        : command.target.onvifPort;
    if (!port) return failed(command, 'NVR_PORT_NOT_CONFIGURED', false);
    const timeoutMs = command.request.timeoutMs as number;
    if (Date.now() + timeoutMs + 500 >= Date.parse(command.leaseExpiresAt)) {
      return failed(command, 'COMMAND_WINDOW_TOO_SHORT', true);
    }
    try {
      const result = await checkNetworkReachability(command.target.localHost, port, timeoutMs);
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        leaseToken: command.leaseToken,
        outcome: 'succeeded',
        result: { ...result, portKind },
        errorCode: null,
        retryable: false,
      };
    } catch (error) {
      return error instanceof CommandExecutionError
        ? failed(command, error.code, error.retryable)
        : failed(command, 'NETWORK_CHECK_FAILED', true);
    }
  }
  if (!command.target || command.target.vendor.trim().toLowerCase() !== 'dahua') {
    return failed(command, 'NVR_ADAPTER_UNSUPPORTED', false);
  }
  if (!dependencies.credential) return failed(command, 'NVR_CREDENTIALS_NOT_CONFIGURED', false);
  const adapter = new DahuaAdapter(command.target, dependencies.credential, dependencies.dahuaTransport);
  try {
    if (command.commandType === 'nvr_capability_probe') {
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        leaseToken: command.leaseToken,
        outcome: 'succeeded',
        result: await adapter.detectCapabilities(),
        errorCode: null,
        retryable: false,
      };
    }
    if (command.commandType === 'nvr_health_diagnostics') {
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        leaseToken: command.leaseToken,
        outcome: 'succeeded',
        result: await adapter.healthDiagnostics(),
        errorCode: null,
        retryable: false,
      };
    }
    if (command.commandType === 'channel_discovery') {
      const discovery = await adapter.discoverChannels(command.request.diagnostic === true);
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        leaseToken: command.leaseToken,
        outcome: 'succeeded',
        result: {
          channels: discovery.channels,
          diagnostic: {
            ...discovery.diagnostic,
            requestId: command.commandId,
          },
        },
        errorCode: null,
        retryable: false,
      };
    }
    if (command.commandType === 'snapshot_request') {
      if (!dependencies.uploadSnapshot) return failed(command, 'SNAPSHOT_UPLOAD_UNAVAILABLE', true);
      const channelId = command.request.channelId as string;
      const snapshot = await adapter.snapshot(channelId);
      const uploaded = await dependencies.uploadSnapshot({ ...snapshot, channelId });
      return {
        commandId: command.commandId,
        commandType: command.commandType,
        leaseToken: command.leaseToken,
        outcome: 'succeeded',
        result: {
          artifactId: uploaded.artifactId,
          contentType: snapshot.contentType,
          capturedAt: snapshot.capturedAt,
        },
        errorCode: null,
        retryable: false,
      };
    }
    return failed(command, 'NVR_COMMAND_UNSUPPORTED', false);
  } catch (error) {
    const mapped = dahuaFailure(error);
    const diagnostic = mapped.diagnostic
      ? { ...mapped.diagnostic, requestId: command.commandId }
      : null;
    return failed(command, mapped.code, mapped.retryable, diagnostic);
  }
}
