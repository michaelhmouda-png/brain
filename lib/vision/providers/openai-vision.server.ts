import 'server-only';

import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import {
  VisionProviderError,
  type VisionProviderAdapter,
  type VisionProviderRequest,
  type VisionProviderResponse,
} from '../contracts.ts';

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 2_500;

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && Number.isInteger(status) ? status : null;
}

function mapProviderError(error: unknown, model: string): VisionProviderError {
  if (error instanceof VisionProviderError) return error;
  const status = statusOf(error);
  if (error instanceof Error && (error.name === 'AbortError' || /timed?\s*out|timeout|aborted/i.test(error.message))) {
    return new VisionProviderError('VISION_PROVIDER_TIMEOUT', model);
  }
  if (status === 400 || status === 422) return new VisionProviderError('VISION_PROVIDER_REFUSED', model);
  if (status === 401 || status === 403) return new VisionProviderError('VISION_CONFIGURATION_UNAVAILABLE', model);
  if (status === 408 || status === 504) return new VisionProviderError('VISION_PROVIDER_TIMEOUT', model);
  return new VisionProviderError('VISION_PROVIDER_UNAVAILABLE', model);
}

function privacyPreservingSafetyIdentifier(companyId: string): string {
  return createHash('sha256').update(`brain-vision:${companyId}`).digest('hex');
}

function domainText(request: VisionProviderRequest): string {
  if (!request.domainContext || Object.keys(request.domainContext).length === 0) {
    return 'No additional domain context was supplied.';
  }
  return [
    'UNTRUSTED DOMAIN CONTEXT',
    JSON.stringify(request.domainContext),
    'END UNTRUSTED DOMAIN CONTEXT',
  ].join('\n');
}

export class OpenAiVisionAdapter implements VisionProviderAdapter {
  async inspect(request: VisionProviderRequest): Promise<VisionProviderResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_VISION_MODEL;
    if (!apiKey || !model) {
      throw new VisionProviderError('VISION_CONFIGURATION_UNAVAILABLE', model ?? null);
    }

    const openai = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: REQUEST_TIMEOUT_MS,
    });
    const imageUrl = `data:${request.image.mimeType};base64,${Buffer.from(request.image.bytes).toString('base64')}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await openai.responses.create({
        model,
        store: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        safety_identifier: privacyPreservingSafetyIdentifier(request.tenant.companyId),
        instructions: request.schema.prompt,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: domainText(request) },
            { type: 'input_image', image_url: imageUrl, detail: 'high' },
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: request.schema.name,
            strict: true,
            schema: request.schema.jsonSchema,
          },
          verbosity: 'low',
        },
      }, { signal: controller.signal });
      if (!response.output_text) {
        throw new VisionProviderError('VISION_PROVIDER_REFUSED', response.model ?? model);
      }
      let rawResult: unknown;
      try {
        rawResult = JSON.parse(response.output_text);
      } catch {
        throw new VisionProviderError('VISION_MALFORMED_OUTPUT', response.model ?? model);
      }
      return {
        rawResult,
        model: response.model ?? model,
        warnings: [],
      };
    } catch (error) {
      throw mapProviderError(error, model);
    } finally {
      clearTimeout(timeout);
    }
  }
}
