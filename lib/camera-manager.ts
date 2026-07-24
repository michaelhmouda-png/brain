import type { CompanyApiRole } from './company-api-authorization';

export const CAMERA_MANAGER_ROLES = ['super_admin', 'owner', 'manager'] as const;
export const NVR_ADMIN_ROLES = ['super_admin', 'owner'] as const;

export type CameraManagerRole = (typeof CAMERA_MANAGER_ROLES)[number];
export type NvrStatus = 'unconfigured' | 'configured' | 'offline' | 'online' | 'error';
export type CameraStatus = 'unconfigured' | 'offline' | 'online' | 'disabled' | 'error';

export type NvrWriteInput = {
  id?: string;
  locationId: string;
  gatewayId: string | null;
  name: string;
  vendor: string;
  localHost: string;
  httpPort: number | null;
  rtspPort: number | null;
  onvifPort: number | null;
  usernameSecretReference?: string | null;
  passwordSecretReference?: string | null;
  status: NvrStatus;
};

export type CameraWriteInput = {
  id: string;
  name: string;
  area: string | null;
  department: string | null;
  aiEnabled: boolean;
  taskVerificationEnabled: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9/_-]{2,127}$/i;

export function canViewCameraManager(role: CompanyApiRole): role is CameraManagerRole {
  return CAMERA_MANAGER_ROLES.some((allowed) => allowed === role);
}

export function canManageNvrs(role: CompanyApiRole): boolean {
  return NVR_ADMIN_ROLES.some((allowed) => allowed === role);
}

function record(input: unknown): Record<string, unknown> | null {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, max: number, nullable = false): string | null | undefined {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max ? normalized : undefined;
}

function nullablePort(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65535 ? Number(value) : undefined;
}

export function isSafeLocalHost(value: string): boolean {
  if (!value || value.length > 253 || /[:/@\\?#\s]/.test(value)) return false;

  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    if (ipv4.slice(1).some((part) => part.length > 1 && part.startsWith('0'))) return false;
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return false;
    const [first, second, third, fourth] = octets;
    if (first === 0 || first === 127 || (first === 169 && second === 254)) return false;
    if (first >= 224) return false;
    if (first === 255 && second === 255 && third === 255 && fourth === 255) return false;
    return true;
  }

  // A dotted numeric value that failed the IPv4 shape/range check must not be
  // reinterpreted as a DNS hostname.
  if (/^[\d.]+$/.test(value)) return false;
  const labels = value.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.some((label) => label === 'localhost')) return false;
  return labels.length >= 1 && labels.every((label) =>
    label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

function secretReference(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && SECRET_REFERENCE_PATTERN.test(value) ? value : undefined;
}

export function parseNvrWrite(input: unknown, requireId: boolean): NvrWriteInput | null {
  const body = record(input);
  if (!body) return null;
  const id = requireId && typeof body.id === 'string' && UUID_PATTERN.test(body.id) ? body.id : undefined;
  const locationId = typeof body.locationId === 'string' && UUID_PATTERN.test(body.locationId) ? body.locationId : null;
  const gatewayId = body.gatewayId === null || body.gatewayId === undefined
    ? null
    : typeof body.gatewayId === 'string' && UUID_PATTERN.test(body.gatewayId) ? body.gatewayId : undefined;
  const name = boundedText(body.name, 120);
  const vendor = boundedText(body.vendor, 80);
  const localHost = boundedText(body.localHost, 255);
  const httpPort = nullablePort(body.httpPort);
  const rtspPort = nullablePort(body.rtspPort);
  const onvifPort = nullablePort(body.onvifPort);
  const usernameSecretReference = secretReference(body.usernameSecretReference);
  const passwordSecretReference = secretReference(body.passwordSecretReference);
  const statuses: NvrStatus[] = ['unconfigured', 'configured', 'offline', 'online', 'error'];
  const status = typeof body.status === 'string' && statuses.includes(body.status as NvrStatus) ? body.status as NvrStatus : null;
  if ((requireId && !id) || !locationId || gatewayId === undefined || !name || !vendor || !localHost || body.localHost !== localHost || !isSafeLocalHost(localHost) || httpPort === undefined || rtspPort === undefined || onvifPort === undefined || usernameSecretReference === undefined || passwordSecretReference === undefined || !status) return null;
  return { id, locationId, gatewayId, name, vendor, localHost, httpPort, rtspPort, onvifPort, usernameSecretReference, passwordSecretReference, status };
}

export function parseCameraWrite(input: unknown): CameraWriteInput | null {
  const body = record(input);
  if (!body || typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) return null;
  const name = boundedText(body.name, 120);
  const area = boundedText(body.area, 120, true);
  const department = boundedText(body.department, 120, true);
  if (!name || area === undefined || department === undefined || typeof body.aiEnabled !== 'boolean' || typeof body.taskVerificationEnabled !== 'boolean') return null;
  return { id: body.id, name, area, department, aiEnabled: body.aiEnabled, taskVerificationEnabled: body.taskVerificationEnabled };
}
