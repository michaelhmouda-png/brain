import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { inspectJpeg } from '../../lib/brain-agent/jpeg.ts';
import { resolvePrivateNvrAddress } from './network-safety.ts';

export type DahuaCredential = { username: string; password: string };
export type DahuaTarget = { localHost: string; httpPort: number | null; vendor: string };
export type DahuaChannel = {
  externalChannelId: string;
  name: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'disabled' | 'error';
};
export type DahuaChannelDiagnostic = {
  httpStatus: number;
  contentType: 'text/plain' | 'application/json' | 'text/html' | 'application/octet-stream' | 'unknown';
  responseByteLength: number;
  responseLineCount: number;
  responseFormat: 'key_value_lines' | 'json' | 'xml' | 'html' | 'unknown_text' | 'binary';
  sanitizedKeys: string[];
  sections: string[];
  repeatedChannelLikeRecords: number;
  knownFields: {
    uniqueChannel: boolean;
    deviceName: boolean;
    channelName: boolean;
    name: boolean;
    enabled: boolean;
    connectionState: boolean;
    state: boolean;
    resolution: boolean;
    codec: boolean;
  };
  parserBranch: 'result_records_v1' | 'camera_records_v1' | 'no_supported_records' | 'unknown_response';
  safeParseFailureCode: 'NO_SUPPORTED_CHANNEL_RECORDS' | 'UNKNOWN_CHANNEL_RESPONSE_FORMAT' | null;
  responseTimeMs: number;
};
export type DahuaResponse = { status: number; headers: Record<string, string>; body: Uint8Array };
export type DahuaTransport = (request: {
  host: string;
  port: number;
  path: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maximumBytes: number;
}) => Promise<DahuaResponse>;
export type DahuaOperation = 'system_info' | 'current_time' | 'camera_inventory' | 'snapshot';
export type DahuaSafeErrorCode =
  | 'NETWORK_UNREACHABLE'
  | 'CONNECTION_REFUSED'
  | 'CONNECTION_TIMEOUT'
  | 'TLS_OR_PROTOCOL_MISMATCH'
  | 'HTTP_UNAUTHORIZED'
  | 'HTTP_FORBIDDEN'
  | 'HTTP_NOT_FOUND'
  | 'DIGEST_AUTH_FAILED'
  | 'MALFORMED_DAHUA_RESPONSE'
  | 'RESPONSE_LIMIT_EXCEEDED'
  | 'NVR_REQUEST_FAILED';

export class DahuaSafeError extends Error {
  readonly safeCode: DahuaSafeErrorCode;
  readonly httpStatus: number | null;
  readonly operation: DahuaOperation;
  readonly responseTimeMs: number;
  readonly retryable: boolean;

  constructor(
    safeCode: DahuaSafeErrorCode,
    httpStatus: number | null,
    operation: DahuaOperation,
    responseTimeMs: number,
    retryable: boolean,
  ) {
    super(safeCode);
    this.safeCode = safeCode;
    this.httpStatus = httpStatus;
    this.operation = operation;
    this.responseTimeMs = responseTimeMs;
    this.retryable = retryable;
  }
}

class DahuaRequestSignal extends Error {
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.status = status;
  }
}

const SYSTEM_INFO_PATH = '/cgi-bin/magicBox.cgi?action=getSystemInfo';
const CAMERA_ALL_PATH = '/cgi-bin/LogicDeviceManager.cgi?action=getCameraAll';
const CURRENT_TIME_PATH = '/cgi-bin/global.cgi?action=getCurrentTime';
const SNAPSHOT_PATH = /^\/cgi-bin\/snapshot\.cgi\?channel=(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/;
const READ_ONLY_CAPABILITIES = [
  'dahua.cgi.v1',
  'nvr.health_diagnostics',
  'nvr.channel_discovery',
  'nvr.camera_inventory_sync',
  'nvr.snapshot',
] as const;

function allowedPath(path: string): boolean {
  return path === SYSTEM_INFO_PATH || path === CAMERA_ALL_PATH || path === CURRENT_TIME_PATH || SNAPSHOT_PATH.test(path);
}

function hostHeader(host: string, port: number): string {
  const formatted = host.includes(':') ? `[${host}]` : host;
  return port === 80 ? formatted : `${formatted}:${port}`;
}

export const privateDahuaTransport: DahuaTransport = async (input) => {
  if (!allowedPath(input.path) || input.timeoutMs < 250 || input.timeoutMs > 15_000 || input.maximumBytes < 1 || input.maximumBytes > 5_242_880) {
    throw new Error('DAHUA_REQUEST_NOT_ALLOWED');
  }
  const target = await resolvePrivateNvrAddress(input.host);
  return await new Promise<DahuaResponse>((resolve, reject) => {
    const request = httpRequest({
      host: target.address,
      family: target.family,
      port: input.port,
      method: 'GET',
      path: input.path,
      headers: { ...input.headers, Host: hostHeader(input.host, input.port), Connection: 'close' },
      agent: false,
    });
    const timer = setTimeout(() => request.destroy(new Error('DAHUA_REQUEST_TIMEOUT')), input.timeoutMs);
    request.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.once('response', (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > input.maximumBytes) {
          response.destroy(new Error('DAHUA_RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      response.once('end', () => {
        clearTimeout(timer);
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers[name.toLowerCase()] = value;
          else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(', ');
        }
        resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
      });
    });
    request.end();
  });
};

type DigestChallenge = {
  realm: string;
  nonce: string;
  qop: 'auth';
  opaque?: string;
  algorithm: 'MD5';
};

function parseDigestParts(value: string): Record<string, string> | null {
  if (!value.startsWith('Digest ')) return null;
  const source = value.slice(7);
  const result: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (source[index] === ' ' || source[index] === ',') index += 1;
    const keyStart = index;
    while (/[A-Za-z]/.test(source[index] ?? '')) index += 1;
    const key = source.slice(keyStart, index).toLowerCase();
    if (!key || source[index] !== '=') return null;
    index += 1;
    let parsed = '';
    if (source[index] === '"') {
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          index += 1;
          if (index >= source.length) return null;
        }
        parsed += source[index];
        index += 1;
      }
      if (source[index] !== '"') return null;
      index += 1;
    } else {
      const valueStart = index;
      while (index < source.length && source[index] !== ',') index += 1;
      parsed = source.slice(valueStart, index).trim();
    }
    result[key] = parsed;
    while (source[index] === ' ') index += 1;
    if (index < source.length && source[index] !== ',') return null;
  }
  return result;
}

export function parseDigestChallenge(value: string | undefined): DigestChallenge | null {
  if (!value || value.length > 2048) return null;
  const parts = parseDigestParts(value);
  if (!parts || !parts.realm || !parts.nonce || parts.realm.length > 256 || parts.nonce.length > 512) return null;
  const qops = (parts.qop ?? '').split(',').map((item) => item.trim().toLowerCase());
  if (!qops.includes('auth')) return null;
  if (parts.algorithm && parts.algorithm.toUpperCase() !== 'MD5') return null;
  if ([parts.realm, parts.nonce, parts.opaque ?? ''].some((item) => /[\r\n]/.test(item))) return null;
  return { realm: parts.realm, nonce: parts.nonce, qop: 'auth', opaque: parts.opaque, algorithm: 'MD5' };
}

const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex');
const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function createDigestAuthorization(
  challenge: DigestChallenge,
  credential: DahuaCredential,
  path: string,
  cnonce = randomBytes(16).toString('hex'),
): string {
  if (!allowedPath(path)
      || !credential.username || credential.username.length > 128 || /[\r\n]/.test(credential.username)
      || !credential.password || credential.password.length > 256 || /[\r\n]/.test(credential.password)) {
    throw new Error('DAHUA_CREDENTIAL_INVALID');
  }
  const nc = '00000001';
  const ha1 = md5(`${credential.username}:${challenge.realm}:${credential.password}`);
  const ha2 = md5(`GET:${path}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`);
  const fields = [
    `username="${quote(credential.username)}"`,
    `realm="${quote(challenge.realm)}"`,
    `nonce="${quote(challenge.nonce)}"`,
    `uri="${quote(path)}"`,
    'algorithm=MD5',
    `response="${response}"`,
    'qop=auth',
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
  ];
  if (challenge.opaque) fields.push(`opaque="${quote(challenge.opaque)}"`);
  return `Digest ${fields.join(', ')}`;
}

async function authenticatedGet(
  target: DahuaTarget,
  credential: DahuaCredential,
  path: string,
  maximumBytes: number,
  transport: DahuaTransport,
): Promise<DahuaResponse> {
  const port = target.httpPort;
  if (target.vendor.trim().toLowerCase() !== 'dahua'
      || !target.localHost || target.localHost.length > 253 || /[\r\n]/.test(target.localHost)
      || typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535
      || !allowedPath(path)) {
    throw new Error('DAHUA_TARGET_INVALID');
  }
  const initial = await transport({ host: target.localHost, port, path, headers: {}, timeoutMs: 10_000, maximumBytes });
  if (initial.status >= 300 && initial.status < 400) throw new DahuaRequestSignal('DAHUA_PROTOCOL_MISMATCH', initial.status);
  if (initial.status === 200) return initial;
  if (initial.status === 403) throw new DahuaRequestSignal('DAHUA_HTTP_FORBIDDEN', initial.status);
  if (initial.status === 404) throw new DahuaRequestSignal('DAHUA_HTTP_NOT_FOUND', initial.status);
  if (initial.status !== 401) throw new DahuaRequestSignal('DAHUA_REQUEST_FAILED', initial.status);
  const challenge = parseDigestChallenge(initial.headers['www-authenticate']);
  if (!challenge) throw new DahuaRequestSignal('DAHUA_HTTP_UNAUTHORIZED', initial.status);
  const authorization = createDigestAuthorization(challenge, credential, path);
  const response = await transport({
    host: target.localHost,
    port,
    path,
    headers: { Authorization: authorization },
    timeoutMs: 10_000,
    maximumBytes,
  });
  if (response.status >= 300 && response.status < 400) throw new DahuaRequestSignal('DAHUA_PROTOCOL_MISMATCH', response.status);
  if (response.status === 401) throw new DahuaRequestSignal('DAHUA_DIGEST_AUTH_FAILED', response.status);
  if (response.status === 403) throw new DahuaRequestSignal('DAHUA_HTTP_FORBIDDEN', response.status);
  if (response.status === 404) throw new DahuaRequestSignal('DAHUA_HTTP_NOT_FOUND', response.status);
  if (response.status !== 200) throw new DahuaRequestSignal('DAHUA_REQUEST_FAILED', response.status);
  return response;
}

function elapsedMs(started: number): number {
  return Math.min(60_000, Math.max(0, Math.round(performance.now() - started)));
}

function nodeErrorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code.toUpperCase()
    : '';
}

function safeDahuaError(error: unknown, operation: DahuaOperation, started: number): DahuaSafeError {
  if (error instanceof DahuaSafeError) return error;
  const message = error instanceof Error ? error.message : '';
  const status = error instanceof DahuaRequestSignal ? error.status : null;
  const code = nodeErrorCode(error);
  let safeCode: DahuaSafeErrorCode = 'NVR_REQUEST_FAILED';
  let retryable = true;
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
      || message === 'NVR_DNS_LOOKUP_FAILED') {
    safeCode = 'NETWORK_UNREACHABLE';
  } else if (code === 'ECONNREFUSED') {
    safeCode = 'CONNECTION_REFUSED';
  } else if (code === 'ETIMEDOUT' || message === 'DAHUA_REQUEST_TIMEOUT') {
    safeCode = 'CONNECTION_TIMEOUT';
  } else if (code === 'EPROTO' || code.startsWith('ERR_SSL_') || code.startsWith('HPE_')
      || message === 'DAHUA_PROTOCOL_MISMATCH') {
    safeCode = 'TLS_OR_PROTOCOL_MISMATCH';
    retryable = false;
  } else if (message === 'DAHUA_HTTP_UNAUTHORIZED') {
    safeCode = 'HTTP_UNAUTHORIZED';
    retryable = false;
  } else if (message === 'DAHUA_HTTP_FORBIDDEN') {
    safeCode = 'HTTP_FORBIDDEN';
    retryable = false;
  } else if (message === 'DAHUA_HTTP_NOT_FOUND') {
    safeCode = 'HTTP_NOT_FOUND';
    retryable = false;
  } else if (message === 'DAHUA_DIGEST_AUTH_FAILED') {
    safeCode = 'DIGEST_AUTH_FAILED';
    retryable = false;
  } else if (['DAHUA_RESPONSE_INVALID', 'DAHUA_SNAPSHOT_INVALID'].includes(message)) {
    safeCode = 'MALFORMED_DAHUA_RESPONSE';
    retryable = false;
  } else if (['DAHUA_RESPONSE_TOO_LARGE', 'DAHUA_CHANNEL_LIMIT_EXCEEDED'].includes(message)) {
    safeCode = 'RESPONSE_LIMIT_EXCEEDED';
    retryable = false;
  }
  return new DahuaSafeError(safeCode, status, operation, elapsedMs(started), retryable);
}

export function parseDahuaKeyValues(body: Uint8Array): Map<string, string> {
  if (body.byteLength > 1_048_576) throw new Error('DAHUA_RESPONSE_TOO_LARGE');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  if (text.includes('\0')) throw new Error('DAHUA_RESPONSE_INVALID');
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) throw new Error('DAHUA_RESPONSE_INVALID');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9_.\[\]-]{0,159}$/.test(key) || value.length > 1024) throw new Error('DAHUA_RESPONSE_INVALID');
    values.set(key, value);
  }
  return values;
}

export function parseDahuaChannels(values: Map<string, string>): DahuaChannel[] {
  const records = new Map<number, Record<string, string>>();
  for (const [key, value] of values) {
    const match = key.match(/^(?:result|camera)\[(\d{1,3})\]\.([A-Za-z][A-Za-z0-9]{0,63})$/);
    if (!match) continue;
    const index = Number(match[1]);
    if (index > 255) continue;
    records.set(index, { ...(records.get(index) ?? {}), [match[2]]: value });
  }
  const channels: DahuaChannel[] = [];
  const ids = new Set<string>();
  for (const [index, record] of [...records].sort((left, right) => left[0] - right[0])) {
    const uniqueChannel = /^\d{1,3}$/.test(record.UniqueChannel ?? '') ? Number(record.UniqueChannel) : index;
    if (uniqueChannel < 0 || uniqueChannel > 255) continue;
    const externalChannelId = String(uniqueChannel + 1);
    if (ids.has(externalChannelId)) continue;
    ids.add(externalChannelId);
    const nameCandidate = record.DeviceName || record.ChannelName || record.Name || `Channel ${externalChannelId}`;
    const name = nameCandidate.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || `Channel ${externalChannelId}`;
    const enabled = !['false', '0', 'disabled'].includes((record.Enable ?? 'true').toLowerCase());
    const state = (record.ConnectionState ?? record.State ?? '').toLowerCase();
    const status: DahuaChannel['status'] = !enabled
      ? 'disabled'
      : ['connected', 'online', 'connect'].includes(state)
        ? 'online'
        : ['error', 'connectfailed', 'authfailed'].includes(state)
          ? 'error'
          : 'offline';
    channels.push({ externalChannelId, name, enabled, status });
  }
  if (channels.length > 256) throw new Error('DAHUA_CHANNEL_LIMIT_EXCEEDED');
  return channels;
}

const SENSITIVE_FIELD_NAME = /(?:password|username|address|ip|mac|serial|url|uri|token|credential)/i;
const CHANNEL_KEY = /^(result|camera|table\.All|table\.Channel)\[(\d{1,3})\]\.([A-Za-z][A-Za-z0-9]{0,63})$/;

function safeContentType(value: string | undefined): DahuaChannelDiagnostic['contentType'] {
  const normalized = value?.split(';')[0].trim().toLowerCase();
  return normalized === 'text/plain'
    || normalized === 'application/json'
    || normalized === 'text/html'
    || normalized === 'application/octet-stream'
    ? normalized
    : 'unknown';
}

function channelResponseStructure(response: DahuaResponse, started: number): {
  values: Map<string, string> | null;
  diagnostic: DahuaChannelDiagnostic;
} {
  let text: string | null = null;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(response.body);
  } catch {
    text = null;
  }
  const trimmed = text?.trimStart() ?? '';
  const responseFormat: DahuaChannelDiagnostic['responseFormat'] = text === null
    ? 'binary'
    : trimmed.startsWith('{') || trimmed.startsWith('[')
      ? 'json'
      : trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html')
        ? 'html'
        : trimmed.startsWith('<')
          ? 'xml'
          : trimmed.split(/\r?\n/).every((line) => !line || line.includes('='))
            ? 'key_value_lines'
            : 'unknown_text';
  let values: Map<string, string> | null = null;
  if (responseFormat === 'key_value_lines') {
    try {
      values = parseDahuaKeyValues(response.body);
    } catch {
      values = null;
    }
  }
  const fields = new Set<string>();
  const sections = new Set<string>();
  const records = new Set<string>();
  const known = new Set<string>();
  if (values) {
    for (const key of values.keys()) {
      const match = key.match(CHANNEL_KEY);
      if (!match) continue;
      const field = match[3];
      sections.add(`${match[1]}[*]`);
      records.add(`${match[1]}:${match[2]}`);
      known.add(field.toLowerCase());
      if (!SENSITIVE_FIELD_NAME.test(field)) fields.add(field);
    }
  }
  const resultRecords = [...records].filter((record) => record.startsWith('result:')).length;
  const cameraRecords = [...records].filter((record) => record.startsWith('camera:')).length;
  const parserBranch: DahuaChannelDiagnostic['parserBranch'] = values === null
    ? 'unknown_response'
    : resultRecords > 0
      ? 'result_records_v1'
      : cameraRecords > 0
        ? 'camera_records_v1'
        : 'no_supported_records';
  const safeParseFailureCode = parserBranch === 'result_records_v1' || parserBranch === 'camera_records_v1'
    ? null
    : parserBranch === 'no_supported_records'
      ? 'NO_SUPPORTED_CHANNEL_RECORDS'
      : 'UNKNOWN_CHANNEL_RESPONSE_FORMAT';
  return {
    values,
    diagnostic: {
      httpStatus: response.status,
      contentType: safeContentType(response.headers['content-type']),
      responseByteLength: response.body.byteLength,
      responseLineCount: text === null || text.length === 0 ? 0 : text.split(/\r?\n/).length,
      responseFormat,
      sanitizedKeys: [...fields].sort().slice(0, 64),
      sections: [...sections].sort().slice(0, 16),
      repeatedChannelLikeRecords: Math.min(256, records.size),
      knownFields: {
        uniqueChannel: known.has('uniquechannel'),
        deviceName: known.has('devicename'),
        channelName: known.has('channelname'),
        name: known.has('name'),
        enabled: known.has('enable'),
        connectionState: known.has('connectionstate'),
        state: known.has('state'),
        resolution: known.has('resolution') || known.has('videoresolution'),
        codec: known.has('codec') || known.has('compression') || known.has('videocompression'),
      },
      parserBranch,
      safeParseFailureCode,
      responseTimeMs: elapsedMs(started),
    },
  };
}

export class DahuaAdapter {
  private readonly target: DahuaTarget;
  private readonly credential: DahuaCredential;
  private readonly transport: DahuaTransport;

  constructor(target: DahuaTarget, credential: DahuaCredential, transport: DahuaTransport = privateDahuaTransport) {
    this.target = target;
    this.credential = credential;
    this.transport = transport;
  }

  private async keyValues(path: string, operation: DahuaOperation) {
    const started = performance.now();
    try {
      const response = await authenticatedGet(this.target, this.credential, path, 1_048_576, this.transport);
      return parseDahuaKeyValues(response.body);
    } catch (error) {
      throw safeDahuaError(error, operation, started);
    }
  }

  async detectCapabilities() {
    const started = performance.now();
    const info = await this.keyValues(SYSTEM_INFO_PATH, 'system_info');
    return {
      vendor: 'Dahua',
      model: (info.get('deviceType') ?? info.get('DeviceType') ?? 'Dahua NVR').slice(0, 80),
      firmwareVersion: (info.get('softwareVersion') ?? info.get('SoftwareVersion') ?? 'unknown').slice(0, 120),
      capabilities: [...READ_ONLY_CAPABILITIES],
      healthy: true,
      responseTimeMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
    };
  }

  async discoverChannels(diagnosticOnly = false) {
    const started = performance.now();
    try {
      const response = await authenticatedGet(
        this.target,
        this.credential,
        CAMERA_ALL_PATH,
        1_048_576,
        this.transport,
      );
      const structured = channelResponseStructure(response, started);
      if (diagnosticOnly) return { channels: [] as DahuaChannel[], diagnostic: structured.diagnostic };
      if (!structured.values || structured.diagnostic.safeParseFailureCode) {
        throw new Error('DAHUA_RESPONSE_INVALID');
      }
      return {
        channels: parseDahuaChannels(structured.values),
        diagnostic: structured.diagnostic,
      };
    } catch (error) {
      throw safeDahuaError(error, 'camera_inventory', started);
    }
  }

  async healthDiagnostics() {
    const started = performance.now();
    const info = await this.keyValues(SYSTEM_INFO_PATH, 'system_info');
    await this.keyValues(CURRENT_TIME_PATH, 'current_time');
    return {
      vendor: 'Dahua',
      model: (info.get('deviceType') ?? info.get('DeviceType') ?? 'Dahua NVR').slice(0, 80),
      firmwareVersion: (info.get('softwareVersion') ?? info.get('SoftwareVersion') ?? 'unknown').slice(0, 120),
      capabilities: [...READ_ONLY_CAPABILITIES],
      healthy: true,
      responseTimeMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
    };
  }

  async snapshot(channelId: string) {
    if (!/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/.test(channelId)) {
      throw new Error('DAHUA_CHANNEL_INVALID');
    }
    const started = performance.now();
    try {
      const response = await authenticatedGet(
        this.target,
        this.credential,
        `/cgi-bin/snapshot.cgi?channel=${channelId}`,
        5_242_880,
        this.transport,
      );
      const contentType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
      const jpeg = inspectJpeg(response.body);
      if (contentType !== 'image/jpeg' || response.body.byteLength > 5_242_880 || !jpeg) {
        throw new Error('DAHUA_SNAPSHOT_INVALID');
      }
      return {
        bytes: response.body,
        contentType: 'image/jpeg' as const,
        capturedAt: new Date().toISOString(),
        width: jpeg.width,
        height: jpeg.height,
      };
    } catch (error) {
      throw safeDahuaError(error, 'snapshot', started);
    }
  }
}
