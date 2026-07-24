import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

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

export async function resolvePrivateNvrAddress(host: string): Promise<{ address: string; family: 4 | 6 }> {
  if (isIP(host)) {
    if (!isPrivateNvrAddress(host)) throw new Error('UNSAFE_NVR_ADDRESS');
    return { address: host, family: isIP(host) as 4 | 6 };
  }
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('NVR_DNS_LOOKUP_FAILED');
  }
  const safe = addresses.find((candidate) => isPrivateNvrAddress(candidate.address));
  if (!safe) throw new Error('UNSAFE_NVR_ADDRESS');
  return { address: safe.address, family: safe.family as 4 | 6 };
}
