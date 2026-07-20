export const TASK_EVIDENCE_BUCKET = 'task-evidence';
export const TASK_EVIDENCE_MAX_BYTES = 20 * 1024 * 1024;
export const TASK_EVIDENCE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
] as const;

export type TaskEvidenceMimeType = (typeof TASK_EVIDENCE_MIME_TYPES)[number];
export type TaskEvidenceSourceType = 'mobile_camera' | 'gallery_upload';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isTaskEvidenceMimeType(value: unknown): value is TaskEvidenceMimeType {
  return typeof value === 'string' && TASK_EVIDENCE_MIME_TYPES.some((mime) => mime === value);
}

export type PrepareTaskEvidenceInput = {
  taskId: string;
  locationId: string | null;
  sourceType: TaskEvidenceSourceType;
  mimeType: TaskEvidenceMimeType;
  sizeBytes: number;
  sha256: string;
  idempotencyKey: string;
};

export function parsePrepareTaskEvidence(value: unknown): PrepareTaskEvidenceInput | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const locationId = input.locationId === null || input.locationId === undefined || input.locationId === ''
    ? null : input.locationId;
  if (!isUuid(input.taskId) || !(locationId === null || isUuid(locationId)) ||
      (input.sourceType !== 'mobile_camera' && input.sourceType !== 'gallery_upload') ||
      !isTaskEvidenceMimeType(input.mimeType) || typeof input.sizeBytes !== 'number' ||
      !Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > TASK_EVIDENCE_MAX_BYTES ||
      typeof input.sha256 !== 'string' || !SHA256_PATTERN.test(input.sha256) || !isUuid(input.idempotencyKey)) return null;
  return {
    taskId: input.taskId,
    locationId,
    sourceType: input.sourceType,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    idempotencyKey: input.idempotencyKey,
  };
}

export function sniffTaskEvidenceMime(bytes: Uint8Array): TaskEvidenceMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp') {
    const brand = new TextDecoder().decode(bytes.slice(8, 12)).toLowerCase();
    if (brand.startsWith('hei') || brand === 'mif1' || brand === 'msf1') return brand.startsWith('hei') ? 'image/heic' : 'image/heif';
  }
  return null;
}
