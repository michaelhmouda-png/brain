import {
  CAMERA_INSPECTION_V1_JSON_SCHEMA,
  CAMERA_INSPECTION_V1_PROMPT,
  CAMERA_INSPECTION_VERSION,
  parseCameraInspectionV1,
  type CameraInspectionV1Result,
} from './camera-inspection-v1.ts';

export const VISION_INSPECTION_TYPES = [CAMERA_INSPECTION_VERSION] as const;
export type VisionInspectionType = (typeof VISION_INSPECTION_TYPES)[number];
export type VisionValidatedResult = CameraInspectionV1Result;

export type VisionSchemaDefinition = {
  name: VisionInspectionType;
  prompt: string;
  jsonSchema: typeof CAMERA_INSPECTION_V1_JSON_SCHEMA;
  parse(value: unknown): VisionValidatedResult | null;
};

const CAMERA_INSPECTION_SCHEMA: VisionSchemaDefinition = {
  name: CAMERA_INSPECTION_VERSION,
  prompt: CAMERA_INSPECTION_V1_PROMPT,
  jsonSchema: CAMERA_INSPECTION_V1_JSON_SCHEMA,
  parse: parseCameraInspectionV1,
};

export function getVisionSchema(type: VisionInspectionType): VisionSchemaDefinition {
  if (type === CAMERA_INSPECTION_VERSION) return CAMERA_INSPECTION_SCHEMA;
  throw new Error('VISION_SCHEMA_NOT_FOUND');
}

export function isVisionInspectionType(value: unknown): value is VisionInspectionType {
  return typeof value === 'string'
    && VISION_INSPECTION_TYPES.some((candidate) => candidate === value);
}
