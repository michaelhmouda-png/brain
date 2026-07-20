import type { CompanyApiRole } from './company-api-authorization';

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export type AnnouncementCreationInput = {
  title: string;
  content: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  expiresAt: string | null;
};

export function canCreateAnnouncement(role: CompanyApiRole): boolean {
  return role === 'super_admin' || role === 'owner' || role === 'manager';
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

export function parseAnnouncementCreationRequest(body: unknown): AnnouncementCreationInput | null {
  const envelope = object(body);
  const data = envelope?.action === 'create' ? object(envelope.data) : null;
  if (!data) return null;

  // The live announcements schema is company-wide and has no location column.
  // Reject rather than silently accepting a client-selected location scope.
  if (data.locationId !== undefined && data.locationId !== null && data.locationId !== '') return null;

  const title = boundedText(data.title, 200);
  const content = boundedText(data.content, 10_000);
  const priority = data.priority === undefined || data.priority === '' ? 'normal' : data.priority;
  const expiresAt = data.expiresAt === undefined || data.expiresAt === null || data.expiresAt === ''
    ? null
    : typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt))
      ? new Date(data.expiresAt).toISOString()
      : undefined;

  if (!title || !content || typeof priority !== 'string' || !PRIORITIES.has(priority) || expiresAt === undefined) {
    return null;
  }

  return {
    title,
    content,
    priority: priority as AnnouncementCreationInput['priority'],
    expiresAt,
  };
}
