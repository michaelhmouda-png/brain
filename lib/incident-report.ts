import type { CompanyApiRole } from './company-api-authorization';

const INCIDENT_TYPES = new Set([
  'guest_injury', 'employee_injury', 'fight', 'power_outage',
  'equipment_failure', 'lost_item', 'other',
]);
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type IncidentCreationInput = {
  title: string;
  description: string;
  incidentType: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  locationId: string | null;
  affectedArea: string | null;
  incidentTime: string;
};

export function canCreateIncident(role: CompanyApiRole): boolean {
  return role === 'employee' || role === 'manager' || role === 'owner' || role === 'super_admin';
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

export function parseIncidentCreationRequest(body: unknown): IncidentCreationInput | null {
  const envelope = object(body);
  const data = envelope?.action === 'create' ? object(envelope.data) : null;
  if (!data) return null;

  const title = boundedText(data.title, 200);
  const description = boundedText(data.description, 5000);
  const incidentType = data.incidentType === null || data.incidentType === undefined || data.incidentType === ''
    ? null
    : boundedText(data.incidentType, 50);
  const severity = data.severity === undefined || data.severity === '' ? 'medium' : data.severity;
  const locationId = data.locationId === null || data.locationId === undefined || data.locationId === ''
    ? null
    : typeof data.locationId === 'string' && UUID_PATTERN.test(data.locationId) ? data.locationId : null;
  const affectedArea = data.affectedArea === null || data.affectedArea === undefined || data.affectedArea === ''
    ? null
    : boundedText(data.affectedArea, 500);
  const incidentTime = typeof data.incidentTime === 'string' ? data.incidentTime : '';
  const parsedTime = Date.parse(incidentTime);

  if (!title || !description ||
      (incidentType !== null && !INCIDENT_TYPES.has(incidentType)) ||
      typeof severity !== 'string' || !SEVERITIES.has(severity) ||
      (data.locationId && locationId === null) ||
      !incidentTime || !Number.isFinite(parsedTime)) return null;

  return {
    title,
    description,
    incidentType,
    severity: severity as IncidentCreationInput['severity'],
    locationId,
    affectedArea,
    incidentTime: new Date(parsedTime).toISOString(),
  };
}
