import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CAMERA_INSPECTION_VERSION,
  parseCameraInspectionV1,
} from './camera-inspection-v1.ts';
import type {
  CameraInspectionAccess,
  CameraInspectionApplicationError,
  CameraInspectionRecord,
  CameraInspectionSnapshot,
} from './camera-inspection.ts';

type SnapshotRow = {
  id: string;
  company_id: string;
  location_id: string;
  gateway_id: string;
  nvr_connection_id: string;
  external_channel_id: string;
  bucket_id: string;
  storage_path: string;
  content_type: string;
  byte_size: number;
  width: number;
  height: number;
  expires_at: string;
  status: string;
};

function firstRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return typeof row === 'object' && row !== null && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

function snapshotRow(value: unknown): SnapshotRow | null {
  const row = firstRow(value);
  if (!row) return null;
  const stringFields = [
    'id',
    'company_id',
    'location_id',
    'gateway_id',
    'nvr_connection_id',
    'external_channel_id',
    'bucket_id',
    'storage_path',
    'content_type',
    'expires_at',
    'status',
  ];
  if (!stringFields.every((key) => typeof row[key] === 'string')
      || !['byte_size', 'width', 'height'].every((key) =>
        typeof row[key] === 'number' && Number.isInteger(row[key])
      )) return null;
  return row as unknown as SnapshotRow;
}

function inspectionRecord(value: unknown): CameraInspectionRecord | null {
  const row = firstRow(value);
  if (!row
      || typeof row.id !== 'string'
      || !['pending', 'succeeded', 'failed'].includes(String(row.status))
      || row.inspection_version !== CAMERA_INSPECTION_VERSION
      || typeof row.correlation_id !== 'string'
      || typeof row.created_at !== 'string'
      || !Array.isArray(row.warnings)) return null;
  const parsedResult = row.result === null ? null : parseCameraInspectionV1(row.result);
  if (row.result !== null && !parsedResult) return null;
  const warnings = row.warnings.every((item) => typeof item === 'string')
    ? row.warnings as string[]
    : null;
  if (!warnings) return null;
  return {
    id: row.id,
    status: row.status as CameraInspectionRecord['status'],
    inspectionVersion: CAMERA_INSPECTION_VERSION,
    correlationId: row.correlation_id,
    model: typeof row.model === 'string' ? row.model : null,
    result: parsedResult,
    warnings,
    processingDurationMs: typeof row.processing_duration_ms === 'number'
      ? row.processing_duration_ms
      : null,
    errorCode: typeof row.error_code === 'string'
      ? row.error_code as CameraInspectionApplicationError
      : null,
    createdAt: row.created_at,
    completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
  };
}

function mapSnapshot(row: SnapshotRow): CameraInspectionSnapshot | null {
  const channelNumber = Number(row.external_channel_id);
  if (row.bucket_id !== 'camera-snapshots'
      || row.content_type !== 'image/jpeg'
      || row.status !== 'ready'
      || !Number.isInteger(channelNumber)
      || channelNumber < 1
      || channelNumber > 256
      || row.byte_size < 4
      || row.byte_size > 5_242_880
      || row.width < 1
      || row.height < 1
      || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    gatewayId: row.gateway_id,
    nvrId: row.nvr_connection_id,
    channelNumber,
    bucketId: 'camera-snapshots',
    storagePath: row.storage_path,
    contentType: 'image/jpeg',
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    expiresAt: row.expires_at,
  };
}

const INSPECTION_COLUMNS = [
  'id',
  'status',
  'inspection_version',
  'correlation_id',
  'model',
  'result',
  'warnings',
  'processing_duration_ms',
  'error_code',
  'created_at',
  'completed_at',
].join(',');

function requiredInspection(value: unknown): CameraInspectionRecord {
  const parsed = inspectionRecord(value);
  if (!parsed) throw new Error('CAMERA_INSPECTION_RECORD_INVALID');
  return parsed;
}

export function createCameraInspectionAccess(
  authenticated: SupabaseClient,
  service: SupabaseClient,
): CameraInspectionAccess {
  return {
    async loadAuthorizedSnapshot(snapshotId) {
      const { data: authorizedData, error: authorizedError } = await authenticated.rpc(
        'get_device_snapshot_artifact_v2',
        { p_artifact_id: snapshotId },
      );
      const authorized = firstRow(authorizedData);
      if (authorizedError || !authorized || authorized.artifact_id !== snapshotId) return null;

      const { data, error } = await service
        .from('camera_snapshot_artifacts')
        .select('id,company_id,location_id,gateway_id,nvr_connection_id,external_channel_id,bucket_id,storage_path,content_type,byte_size,width,height,expires_at,status')
        .eq('id', snapshotId)
        .maybeSingle();
      if (error) throw new Error('CAMERA_INSPECTION_SNAPSHOT_LOOKUP_FAILED');
      const row = snapshotRow(data);
      if (!row
          || authorized.bucket_id !== row.bucket_id
          || authorized.storage_path !== row.storage_path
          || authorized.content_type !== row.content_type
          || authorized.byte_size !== row.byte_size
          || authorized.width !== row.width
          || authorized.height !== row.height
          || authorized.expires_at !== row.expires_at) return null;
      return mapSnapshot(row);
    },

    async locationIsAccessible(companyId, locationId) {
      const { data, error } = await authenticated
        .from('locations')
        .select('id,company_id')
        .eq('id', locationId)
        .eq('company_id', companyId)
        .eq('status', 'active')
        .maybeSingle();
      return !error && data?.id === locationId && data.company_id === companyId;
    },

    async loadSucceededForSnapshot(snapshotId, companyId) {
      const { data, error } = await service
        .from('camera_inspections')
        .select(INSPECTION_COLUMNS)
        .eq('snapshot_artifact_id', snapshotId)
        .eq('company_id', companyId)
        .eq('inspection_version', CAMERA_INSPECTION_VERSION)
        .eq('status', 'succeeded')
        .maybeSingle();
      if (error) throw new Error('CAMERA_INSPECTION_LOOKUP_FAILED');
      return data ? requiredInspection(data) : null;
    },

    async createPending({ actor, snapshot }) {
      const { data, error } = await service
        .from('camera_inspections')
        .insert({
          company_id: actor.companyId,
          location_id: snapshot.locationId,
          nvr_connection_id: snapshot.nvrId,
          gateway_id: snapshot.gatewayId,
          snapshot_artifact_id: snapshot.id,
          channel_number: snapshot.channelNumber,
          inspection_version: CAMERA_INSPECTION_VERSION,
          status: 'pending',
          correlation_id: actor.correlationId,
          created_by: actor.profileId,
        })
        .select(INSPECTION_COLUMNS)
        .single();
      if (error) throw new Error('CAMERA_INSPECTION_CREATE_FAILED');
      return requiredInspection(data);
    },

    async downloadPrivateSnapshot(snapshot) {
      const { data, error } = await service.storage
        .from(snapshot.bucketId)
        .download(snapshot.storagePath);
      if (error || !data || data.type !== snapshot.contentType || data.size !== snapshot.byteSize) {
        throw new Error('CAMERA_INSPECTION_STORAGE_UNAVAILABLE');
      }
      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        mimeType: 'image/jpeg',
        width: snapshot.width,
        height: snapshot.height,
      };
    },

    async complete(input) {
      const { data, error } = await service
        .from('camera_inspections')
        .update({
          status: 'succeeded',
          model: input.model,
          result: input.result,
          warnings: input.warnings,
          processing_duration_ms: input.processingDurationMs,
          error_code: null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', input.inspectionId)
        .eq('company_id', input.companyId)
        .eq('status', 'pending')
        .select(INSPECTION_COLUMNS)
        .single();
      if (error) throw new Error('CAMERA_INSPECTION_COMPLETE_FAILED');
      return requiredInspection(data);
    },

    async fail(input) {
      const { data, error } = await service
        .from('camera_inspections')
        .update({
          status: 'failed',
          model: input.model,
          result: null,
          warnings: input.warnings,
          processing_duration_ms: input.processingDurationMs,
          error_code: input.errorCode,
          completed_at: new Date().toISOString(),
        })
        .eq('id', input.inspectionId)
        .eq('company_id', input.companyId)
        .eq('status', 'pending')
        .select(INSPECTION_COLUMNS)
        .single();
      if (error) throw new Error('CAMERA_INSPECTION_FAILURE_PERSIST_FAILED');
      return requiredInspection(data);
    },
  };
}
