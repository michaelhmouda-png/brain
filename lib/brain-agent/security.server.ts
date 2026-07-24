import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TOKEN = new RegExp(`^brain_agent_v1_(${UUID})_([A-Za-z0-9_-]{43})$`, 'i');
const PEPPER = /^[0-9a-fA-F]{64}$/;

type PepperName = 'BRAIN_AGENT_TOKEN_PEPPER' | 'BRAIN_AGENT_RATE_LIMIT_PEPPER';

function peppers(): Record<PepperName, Buffer> {
  const tokenValue = process.env.BRAIN_AGENT_TOKEN_PEPPER;
  const rateValue = process.env.BRAIN_AGENT_RATE_LIMIT_PEPPER;
  if (!tokenValue || !rateValue || !PEPPER.test(tokenValue) || !PEPPER.test(rateValue)) {
    throw new Error('BRAIN_AGENT_SECURITY_CONFIGURATION_MISSING');
  }
  const token = Buffer.from(tokenValue, 'hex');
  const rate = Buffer.from(rateValue, 'hex');
  if (token.length !== 32 || rate.length !== 32 || token.equals(rate)) {
    throw new Error('BRAIN_AGENT_SECURITY_CONFIGURATION_INVALID');
  }
  return { BRAIN_AGENT_TOKEN_PEPPER: token, BRAIN_AGENT_RATE_LIMIT_PEPPER: rate };
}

function hmacRateIdentity(kind: 'address' | 'agent', value: string): string {
  return createHmac('sha256', peppers().BRAIN_AGENT_RATE_LIMIT_PEPPER)
    .update(`brain-agent-rate-v2:${kind}:${value}`, 'utf8')
    .digest('hex');
}

function normalizedClientAddress(request: Request): string {
  if (process.env.VERCEL === '1') {
    const value = request.headers.get('x-forwarded-for');
    if (!value || value.includes(',') || value !== value.trim() || isIP(value) === 0) {
      throw new Error('BRAIN_AGENT_TRUSTED_CLIENT_ADDRESS_UNAVAILABLE');
    }
    return value.toLowerCase();
  }
  if (process.env.NODE_ENV !== 'production' && process.env.BRAIN_AGENT_ALLOW_DEVELOPMENT_RATE_ADDRESS === 'true') {
    const value = process.env.BRAIN_AGENT_DEVELOPMENT_RATE_ADDRESS;
    if (!value || isIP(value) === 0) throw new Error('BRAIN_AGENT_DEVELOPMENT_ADDRESS_INVALID');
    return value.toLowerCase();
  }
  throw new Error('BRAIN_AGENT_TRUSTED_CLIENT_ADDRESS_UNAVAILABLE');
}

export function pairingCodeHash(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

export function credentialHash(secret: string): string {
  return createHmac('sha256', peppers().BRAIN_AGENT_TOKEN_PEPPER).update(secret, 'utf8').digest('hex');
}

export function createAgentCredential(publicAgentId: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `brain_agent_v1_${publicAgentId}_${secret}`, hash: credentialHash(secret) };
}

export function parseAgentCredential(header: string | null): { publicAgentId: string; hash: string } | null {
  const supplied = header?.replace(/^Bearer\s+/i, '') ?? '';
  const match = supplied.match(TOKEN);
  return match ? { publicAgentId: match[1].toLowerCase(), hash: credentialHash(match[2]) } : null;
}

export function requestAddressRateKey(request: Request): string {
  return hmacRateIdentity('address', normalizedClientAddress(request));
}

export function agentHeartbeatRateKey(activeCredentialId: string): string {
  if (!new RegExp(`^${UUID}$`, 'i').test(activeCredentialId)) throw new Error('BRAIN_AGENT_IDENTITY_INVALID');
  return hmacRateIdentity('agent', activeCredentialId.toLowerCase());
}

export function previewTrustedAddressEvidence(request: Request, suppliedProof: string | null): { trustedAddressPresent: boolean; parsedAsSingleIp: boolean; fingerprintPrefix: string } {
  if (process.env.VERCEL_ENV !== 'preview') throw new Error('BRAIN_AGENT_HEADER_ACCEPTANCE_DISABLED');
  const expected = createHmac('sha256', peppers().BRAIN_AGENT_TOKEN_PEPPER).update('phase2a-preview-header-acceptance-v1').digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(suppliedProof ?? '', 'base64url'); } catch { throw new Error('BRAIN_AGENT_HEADER_ACCEPTANCE_FORBIDDEN'); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('BRAIN_AGENT_HEADER_ACCEPTANCE_FORBIDDEN');
  const raw = request.headers.get('x-forwarded-for');
  const address = normalizedClientAddress(request);
  return { trustedAddressPresent: Boolean(raw), parsedAsSingleIp: true, fingerprintPrefix: hmacRateIdentity('address', address).slice(0, 12) };
}
