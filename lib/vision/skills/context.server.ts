import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CameraInspectionSnapshot } from '../camera-inspection.ts';
import type {
  VisionSkillCamera,
  VisionSkillCompany,
  VisionSkillLocation,
} from './contracts.ts';

export type VisionSkillEntities = {
  company: VisionSkillCompany;
  location: VisionSkillLocation;
  camera: VisionSkillCamera;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function loadVisionSkillEntities(
  authenticated: SupabaseClient,
  companyId: string,
  snapshot: CameraInspectionSnapshot,
): Promise<VisionSkillEntities | null> {
  const [companyResult, locationResult, cameraResult] = await Promise.all([
    authenticated
      .from('companies')
      .select('id,name,timezone')
      .eq('id', companyId)
      .maybeSingle(),
    authenticated
      .from('locations')
      .select('id,company_id,name,status')
      .eq('id', snapshot.locationId)
      .eq('company_id', companyId)
      .eq('status', 'active')
      .maybeSingle(),
    authenticated
      .from('cameras')
      .select('id,company_id,location_id,nvr_connection_id,external_channel_id,name,area,department,status')
      .eq('company_id', companyId)
      .eq('location_id', snapshot.locationId)
      .eq('nvr_connection_id', snapshot.nvrId)
      .eq('external_channel_id', String(snapshot.channelNumber))
      .maybeSingle(),
  ]);
  if (companyResult.error || locationResult.error || cameraResult.error) return null;
  const company = record(companyResult.data);
  const location = record(locationResult.data);
  const camera = record(cameraResult.data);
  if (!company
      || company.id !== companyId
      || typeof company.name !== 'string'
      || typeof company.timezone !== 'string'
      || !location
      || location.id !== snapshot.locationId
      || location.company_id !== companyId
      || location.status !== 'active'
      || typeof location.name !== 'string'
      || !camera
      || camera.company_id !== companyId
      || camera.location_id !== snapshot.locationId
      || camera.nvr_connection_id !== snapshot.nvrId
      || camera.external_channel_id !== String(snapshot.channelNumber)
      || typeof camera.id !== 'string'
      || typeof camera.name !== 'string'
      || typeof camera.status !== 'string'
      || camera.area !== null && typeof camera.area !== 'string'
      || camera.department !== null && typeof camera.department !== 'string') return null;
  return {
    company: {
      id: companyId,
      name: company.name,
      timezone: company.timezone,
    },
    location: {
      id: snapshot.locationId,
      name: location.name,
    },
    camera: {
      id: camera.id,
      name: camera.name,
      area: camera.area as string | null,
      department: camera.department as string | null,
      status: camera.status,
    },
  };
}
