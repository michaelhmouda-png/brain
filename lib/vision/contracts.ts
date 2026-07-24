import type { VisionInspectionType, VisionSchemaDefinition, VisionValidatedResult } from './schema-registry.ts';

export type VisionDomainValue = string | number | boolean | null;
export type VisionDomainContext = Readonly<Record<string, VisionDomainValue>>;

export type VisionImageInput = {
  bytes: Uint8Array;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
};

export type VisionTenantContext = {
  companyId: string;
  locationId: string;
  correlationId: string;
};

export type VisionProviderRequest = {
  inspectionType: VisionInspectionType;
  schema: VisionSchemaDefinition;
  image: VisionImageInput;
  tenant: VisionTenantContext;
  domainContext?: VisionDomainContext;
};

export type VisionProviderResponse = {
  rawResult: unknown;
  model: string;
  warnings: string[];
};

export interface VisionProviderAdapter {
  inspect(request: VisionProviderRequest): Promise<VisionProviderResponse>;
}

export const VISION_ERROR_CODES = [
  'VISION_CONFIGURATION_UNAVAILABLE',
  'VISION_IMAGE_INVALID',
  'VISION_PROVIDER_TIMEOUT',
  'VISION_PROVIDER_UNAVAILABLE',
  'VISION_PROVIDER_REFUSED',
  'VISION_MALFORMED_OUTPUT',
  'VISION_OUTPUT_POLICY_VIOLATION',
  'VISION_INTERNAL_ERROR',
] as const;

export type VisionErrorCode = (typeof VISION_ERROR_CODES)[number];

export type VisionSuccess = {
  ok: true;
  inspectionType: VisionInspectionType;
  result: VisionValidatedResult;
  model: string;
  processingDurationMs: number;
  warnings: string[];
  correlationId: string;
};

export type VisionFailure = {
  ok: false;
  inspectionType: VisionInspectionType;
  errorCode: VisionErrorCode;
  model: string | null;
  processingDurationMs: number;
  warnings: string[];
  correlationId: string;
};

export type VisionServiceResult = VisionSuccess | VisionFailure;

export class VisionProviderError extends Error {
  public readonly code: VisionErrorCode;
  public readonly model: string | null;

  constructor(
    code: VisionErrorCode,
    model: string | null = null,
  ) {
    super(code);
    this.name = 'VisionProviderError';
    this.code = code;
    this.model = model;
  }
}
