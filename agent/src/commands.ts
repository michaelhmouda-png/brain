import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import net from 'node:net';
import {
  type AgentCommandCompletion,
  type ClaimedDeviceCommand,
} from '../../lib/brain-agent/command-contracts.ts';
import { AGENT_VERSION } from './constants.ts';

class CommandExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

function privateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function isPrivateNvrAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) !== 6) return false;
  if (normalized.startsWith('::ffff:')) return privateIpv4(normalized.slice('::ffff:'.length));
  const first = Number.parseInt(normalized.split(':')[0] || '0', 16);
  return first >= 0xfc00 && first <= 0xfdff;
}

async function resolvePrivateNvrAddress(host: string): Promise<{ address: string; family: 4 | 6 }> {
  if (isIP(host)) {
    if (!isPrivateNvrAddress(host)) throw new CommandExecutionError('UNSAFE_NVR_ADDRESS', false);
    return { address: host, family: isIP(host) as 4 | 6 };
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new CommandExecutionError('NVR_DNS_LOOKUP_FAILED', true);
  }
  const safe = addresses.find((candidate) => isPrivateNvrAddress(candidate.address));
  if (!safe) throw new CommandExecutionError('UNSAFE_NVR_ADDRESS', false);
  return { address: safe.address, family: safe.family as 4 | 6 };
}

export async function checkNetworkReachability(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<{ reachable: boolean; latencyMs: number }> {
  const target = await resolvePrivateNvrAddress(host);
  const started = performance.now();
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: target.address, port, family: target.family });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ reachable, latencyMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))) });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function failed(command: ClaimedDeviceCommand, code: string, retryable: boolean): AgentCommandCompletion {
  return {
    commandId: command.commandId,
    commandType: command.commandType,
    leaseToken: command.leaseToken,
    outcome: 'failed',
    result: {},
    errorCode: code,
    retryable,
  };
}

export async function executeDeviceCommand(command: ClaimedDeviceCommand): Promise<AgentCommandCompletion> {
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
  return failed(command, 'NVR_ADAPTER_NOT_AVAILABLE', false);
}
