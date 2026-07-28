'use client';

import { useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import {
  CAMERA_INSPECTION_VERSION,
  parseCameraInspectionV1,
  type CameraInspectionV1Result,
} from '@/lib/vision/camera-inspection-v1';

type InspectionResponse = {
  inspectionId: string;
  status: 'succeeded';
  inspectionVersion: typeof CAMERA_INSPECTION_VERSION;
  model: string;
  result: CameraInspectionV1Result;
  warnings: string[];
  processingDurationMs: number;
  correlationId: string;
  createdAt: string;
  completedAt: string;
};

function parseInspectionResponse(value: unknown): InspectionResponse | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const envelope = value as { data?: unknown };
  if (typeof envelope.data !== 'object' || envelope.data === null || Array.isArray(envelope.data)) return null;
  const data = envelope.data as Record<string, unknown>;
  const result = parseCameraInspectionV1(data.result);
  if (typeof data.inspectionId !== 'string'
      || data.status !== 'succeeded'
      || data.inspectionVersion !== CAMERA_INSPECTION_VERSION
      || typeof data.model !== 'string'
      || !result
      || !Array.isArray(data.warnings)
      || !data.warnings.every((item) => typeof item === 'string')
      || typeof data.processingDurationMs !== 'number'
      || !Number.isInteger(data.processingDurationMs)
      || data.processingDurationMs < 0
      || typeof data.correlationId !== 'string'
      || typeof data.createdAt !== 'string'
      || typeof data.completedAt !== 'string') return null;
  return {
    inspectionId: data.inspectionId,
    status: 'succeeded',
    inspectionVersion: CAMERA_INSPECTION_VERSION,
    model: data.model,
    result,
    warnings: data.warnings as string[],
    processingDurationMs: data.processingDurationMs,
    correlationId: data.correlationId,
    createdAt: data.createdAt,
    completedAt: data.completedAt,
  };
}

function safeError(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'CAMERA_INSPECTION_UNAVAILABLE';
  }
  const code = (value as { error?: unknown }).error;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)
    ? code
    : 'CAMERA_INSPECTION_UNAVAILABLE';
}

export function CameraInspectionControl({ snapshotId }: { snapshotId: string }) {
  const { messages } = useLocale();
  const copy = messages.cameras;
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inspection, setInspection] = useState<InspectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspect() {
    if (attempted || loading) return;
    setAttempted(true);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/cameras/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          snapshotId,
          inspectionVersion: CAMERA_INSPECTION_VERSION,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseInspectionResponse(payload) : null;
      if (!parsed) {
        setError(safeError(payload));
        return;
      }
      setInspection(parsed);
    } catch {
      setError('CAMERA_INSPECTION_UNAVAILABLE');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-3 rounded-xl border border-violet-400/20 bg-violet-500/5 p-3">
      <button
        type="button"
        onClick={() => void inspect()}
        disabled={attempted || loading}
        className="ui-button-secondary min-h-11 rounded-xl px-4 font-semibold disabled:cursor-not-allowed"
      >
        {loading ? copy.inspectingWithAi : copy.inspectWithAi}
      </button>
      <p className="mt-2 text-xs text-slate-400">{copy.inspectionHumanJudgment}</p>
      {error ? (
        <p role="alert" className="ui-alert ui-alert-error mt-3 break-all rounded-xl p-3 text-xs">
          {copy.inspectionFailed} · {error}
        </p>
      ) : null}
      {inspection ? (
        <div className="mt-3 space-y-3" aria-live="polite">
          <div>
            <h4 className="font-semibold text-violet-100">{copy.inspectionResult}</h4>
            <p className="mt-1 text-sm text-slate-200">{inspection.result.scene.summary}</p>
            <p className="mt-1 text-xs text-slate-400">
              {inspection.model} · {inspection.processingDurationMs} ms
            </p>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-xs text-slate-300">
            {JSON.stringify(inspection.result, null, 2)}
          </pre>
          {inspection.warnings.length > 0 ? (
            <p className="ui-alert ui-alert-warning rounded-xl p-3 text-xs">{inspection.warnings.join(' · ')}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
