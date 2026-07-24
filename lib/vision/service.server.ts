import 'server-only';

import { createVisionService, type VisionSafeLog } from './service.ts';
import { OpenAiVisionAdapter } from './providers/openai-vision.server.ts';

function safeVisionLog(entry: VisionSafeLog): void {
  const method = entry.event === 'vision.failed' ? console.error : console.info;
  method('[Vision Service]', entry);
}

export function createServerVisionService() {
  return createVisionService({
    provider: new OpenAiVisionAdapter(),
    logger: safeVisionLog,
  });
}
