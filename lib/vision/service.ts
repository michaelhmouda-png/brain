import { inspectJpeg } from '../brain-agent/jpeg.ts';
import {
  VisionProviderError,
  type VisionDomainContext,
  type VisionErrorCode,
  type VisionProviderAdapter,
  type VisionServiceResult,
  type VisionTenantContext,
} from './contracts.ts';
import { getVisionSchema, type VisionInspectionType } from './schema-registry.ts';

const MAX_IMAGE_BYTES = 5_242_880;
const WARNING_CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
const DOMAIN_KEY = /^[a-z][a-zA-Z0-9_]{0,63}$/;

export type VisionSafeLog = {
  event: 'vision.completed' | 'vision.failed';
  inspectionType: VisionInspectionType;
  correlationId: string;
  processingDurationMs: number;
  errorCode?: VisionErrorCode;
};

export type VisionServiceLogger = (entry: VisionSafeLog) => void;

export type VisionServiceInput = {
  inspectionType: VisionInspectionType;
  image: {
    bytes: Uint8Array;
    mimeType: 'image/jpeg';
    width: number;
    height: number;
  };
  tenant: VisionTenantContext;
  domainContext?: VisionDomainContext;
};

function validDomainContext(value: VisionDomainContext | undefined): boolean {
  if (!value) return true;
  const entries = Object.entries(value);
  if (entries.length > 20) return false;
  return entries.every(([key, item]) =>
    DOMAIN_KEY.test(key)
    && (item === null
      || typeof item === 'boolean'
      || typeof item === 'number' && Number.isFinite(item)
      || typeof item === 'string' && item.length <= 300)
  );
}

function safeWarnings(value: string[]): string[] {
  if (!Array.isArray(value) || value.length > 20) return [];
  return [...new Set(value.filter((item) => WARNING_CODE.test(item)))];
}

function elapsed(startedAt: number, now: () => number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

function failureCode(error: unknown): { code: VisionErrorCode; model: string | null } {
  if (error instanceof VisionProviderError) return { code: error.code, model: error.model };
  return { code: 'VISION_INTERNAL_ERROR', model: null };
}

export function createVisionService({
  provider,
  now = Date.now,
  logger = () => undefined,
}: {
  provider: VisionProviderAdapter;
  now?: () => number;
  logger?: VisionServiceLogger;
}) {
  return {
    async inspect(input: VisionServiceInput): Promise<VisionServiceResult> {
      const startedAt = now();
      const schema = getVisionSchema(input.inspectionType);
      const jpeg = input.image.mimeType === 'image/jpeg'
        && input.image.bytes.byteLength <= MAX_IMAGE_BYTES
        ? inspectJpeg(input.image.bytes)
        : null;
      if (!jpeg
          || jpeg.width !== input.image.width
          || jpeg.height !== input.image.height
          || !validDomainContext(input.domainContext)) {
        const processingDurationMs = elapsed(startedAt, now);
        const errorCode: VisionErrorCode = 'VISION_IMAGE_INVALID';
        logger({
          event: 'vision.failed',
          inspectionType: input.inspectionType,
          correlationId: input.tenant.correlationId,
          processingDurationMs,
          errorCode,
        });
        return {
          ok: false,
          inspectionType: input.inspectionType,
          errorCode,
          model: null,
          processingDurationMs,
          warnings: [],
          correlationId: input.tenant.correlationId,
        };
      }

      try {
        const response = await provider.inspect({
          inspectionType: input.inspectionType,
          schema,
          image: input.image,
          tenant: input.tenant,
          domainContext: input.domainContext,
        });
        const processingDurationMs = elapsed(startedAt, now);
        const result = schema.parse(response.rawResult);
        if (!result) {
          const errorCode: VisionErrorCode = 'VISION_MALFORMED_OUTPUT';
          logger({
            event: 'vision.failed',
            inspectionType: input.inspectionType,
            correlationId: input.tenant.correlationId,
            processingDurationMs,
            errorCode,
          });
          return {
            ok: false,
            inspectionType: input.inspectionType,
            errorCode,
            model: response.model,
            processingDurationMs,
            warnings: safeWarnings(response.warnings),
            correlationId: input.tenant.correlationId,
          };
        }
        const warnings = safeWarnings(response.warnings);
        logger({
          event: 'vision.completed',
          inspectionType: input.inspectionType,
          correlationId: input.tenant.correlationId,
          processingDurationMs,
        });
        return {
          ok: true,
          inspectionType: input.inspectionType,
          result,
          model: response.model,
          processingDurationMs,
          warnings,
          correlationId: input.tenant.correlationId,
        };
      } catch (error) {
        const processingDurationMs = elapsed(startedAt, now);
        const failure = failureCode(error);
        logger({
          event: 'vision.failed',
          inspectionType: input.inspectionType,
          correlationId: input.tenant.correlationId,
          processingDurationMs,
          errorCode: failure.code,
        });
        return {
          ok: false,
          inspectionType: input.inspectionType,
          errorCode: failure.code,
          model: failure.model,
          processingDurationMs,
          warnings: [],
          correlationId: input.tenant.correlationId,
        };
      }
    },
  };
}

export type VisionService = ReturnType<typeof createVisionService>;
