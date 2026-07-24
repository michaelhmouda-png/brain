import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { resolvePrivateNvrAddress } from './network-safety.ts';

export type DahuaCredential = { username: string; password: string };
export type DahuaTarget = { localHost: string; httpPort: number | null; vendor: string };
export type DahuaChannel = {
  externalChannelId: string;
  name: string;
  enabled: boolean;
  status: 'online' | 'offline' | 'disabled' | 'error';
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

const SYSTEM_INFO_PATH = '/cgi-bin/magicBox.cgi?action=getSystemInfo';
const CAMERA_ALL_PATH = '/cgi-bin/LogicDeviceManager.cgi?action=getCameraAll';
const CURRENT_TIME_PATH = '/cgi-bin/global.cgi?action=getCurrentTime';
const SNAPSHOT_PATH = /^\/cgi-bin\/snapshot\.cgi\?channel=(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/;

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
  if (initial.status >= 300 && initial.status < 400) throw new Error('DAHUA_REDIRECT_REJECTED');
  if (initial.status === 200) return initial;
  if (initial.status !== 401) throw new Error('DAHUA_REQUEST_FAILED');
  const challenge = parseDigestChallenge(initial.headers['www-authenticate']);
  if (!challenge) throw new Error('DAHUA_DIGEST_REQUIRED');
  const authorization = createDigestAuthorization(challenge, credential, path);
  const response = await transport({
    host: target.localHost,
    port,
    path,
    headers: { Authorization: authorization },
    timeoutMs: 10_000,
    maximumBytes,
  });
  if (response.status >= 300 && response.status < 400) throw new Error('DAHUA_REDIRECT_REJECTED');
  if (response.status === 401 || response.status === 403) throw new Error('DAHUA_AUTHENTICATION_FAILED');
  if (response.status !== 200) throw new Error('DAHUA_REQUEST_FAILED');
  return response;
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
    const match = key.match(/^result\[(\d{1,3})\]\.([A-Za-z][A-Za-z0-9]{0,63})$/);
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

export class DahuaAdapter {
  private readonly target: DahuaTarget;
  private readonly credential: DahuaCredential;
  private readonly transport: DahuaTransport;

  constructor(target: DahuaTarget, credential: DahuaCredential, transport: DahuaTransport = privateDahuaTransport) {
    this.target = target;
    this.credential = credential;
    this.transport = transport;
  }

  private async keyValues(path: string) {
    const response = await authenticatedGet(this.target, this.credential, path, 1_048_576, this.transport);
    return parseDahuaKeyValues(response.body);
  }

  async detectCapabilities() {
    const info = await this.keyValues(SYSTEM_INFO_PATH);
    const model = (info.get('deviceType') ?? info.get('DeviceType') ?? 'Dahua NVR').slice(0, 80);
    return {
      vendor: 'Dahua',
      model,
      capabilities: [
        'dahua.cgi.v1',
        'nvr.health_diagnostics',
        'nvr.channel_discovery',
        'nvr.camera_inventory_sync',
        'nvr.snapshot',
      ],
    };
  }

  async discoverChannels() {
    return parseDahuaChannels(await this.keyValues(CAMERA_ALL_PATH));
  }

  async healthDiagnostics() {
    const started = performance.now();
    const info = await this.keyValues(SYSTEM_INFO_PATH);
    const time = await this.keyValues(CURRENT_TIME_PATH);
    return {
      healthy: true,
      vendor: 'Dahua',
      model: (info.get('deviceType') ?? info.get('DeviceType') ?? 'Dahua NVR').slice(0, 80),
      softwareVersion: (info.get('softwareVersion') ?? info.get('SoftwareVersion') ?? 'unknown').slice(0, 120),
      deviceTime: (time.get('result') ?? time.get('time') ?? 'unknown').slice(0, 40),
      latencyMs: Math.min(60_000, Math.max(0, Math.round(performance.now() - started))),
    };
  }

  async snapshot(channelId: string) {
    if (!/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-6])$/.test(channelId)) {
      throw new Error('DAHUA_CHANNEL_INVALID');
    }
    const response = await authenticatedGet(
      this.target,
      this.credential,
      `/cgi-bin/snapshot.cgi?channel=${channelId}`,
      5_242_880,
      this.transport,
    );
    const contentType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/jpeg' || response.body.byteLength < 4 || response.body.byteLength > 5_242_880
       || response.body[0] !== 0xff || response.body[1] !== 0xd8 || response.body[2] !== 0xff) {
      throw new Error('DAHUA_SNAPSHOT_INVALID');
    }
    return { bytes: response.body, contentType: 'image/jpeg' as const, capturedAt: new Date().toISOString() };
  }
}
