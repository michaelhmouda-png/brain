'use client';

import { useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import {
  CAMERA_INSPECTION_VERSION,
  parseCameraInspectionV1,
  type CameraInspectionV1Result,
} from '@/lib/vision/camera-inspection-v1';
import {
  parseVisionSkillResult,
  VISION_SKILL_NAMES,
  type VisionSkillName,
  type VisionSkillResult,
} from '@/lib/vision/skills/contracts';

type SkillExecutionResponse = {
  inspection: {
    inspectionId: string;
    status: 'succeeded';
    inspectionVersion: typeof CAMERA_INSPECTION_VERSION;
    model: string;
    result: CameraInspectionV1Result;
    processingDurationMs: number;
  };
  skill: VisionSkillResult;
};

function parseResponse(value: unknown): SkillExecutionResponse | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const data = (value as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  const inspection = typeof payload.inspection === 'object'
    && payload.inspection !== null
    && !Array.isArray(payload.inspection)
    ? payload.inspection as Record<string, unknown>
    : null;
  const skill = parseVisionSkillResult(payload.skill);
  const inspectionResult = inspection ? parseCameraInspectionV1(inspection.result) : null;
  if (!inspection
      || typeof inspection.inspectionId !== 'string'
      || inspection.status !== 'succeeded'
      || inspection.inspectionVersion !== CAMERA_INSPECTION_VERSION
      || typeof inspection.model !== 'string'
      || typeof inspection.processingDurationMs !== 'number'
      || !Number.isInteger(inspection.processingDurationMs)
      || inspection.processingDurationMs < 0
      || !inspectionResult
      || !skill) return null;
  return {
    inspection: {
      inspectionId: inspection.inspectionId,
      status: 'succeeded',
      inspectionVersion: CAMERA_INSPECTION_VERSION,
      model: inspection.model,
      result: inspectionResult,
      processingDurationMs: inspection.processingDurationMs,
    },
    skill,
  };
}

function safeError(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'CAMERA_SKILL_UNAVAILABLE';
  }
  const code = (value as { error?: unknown }).error;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(code)
    ? code
    : 'CAMERA_SKILL_UNAVAILABLE';
}

export function CameraSkillControl({ snapshotId }: { snapshotId: string }) {
  const { messages } = useLocale();
  const copy = messages.cameras;
  const labels: Record<VisionSkillName, string> = {
    opening_readiness: copy.skillOpeningReadiness,
    closing_readiness: copy.skillClosingReadiness,
    cleanliness: copy.skillCleanliness,
    safety: copy.skillSafety,
    equipment: copy.skillEquipment,
  };
  const [selected, setSelected] = useState<VisionSkillName>('opening_readiness');
  const [loading, setLoading] = useState(false);
  const [execution, setExecution] = useState<SkillExecutionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSkill() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/cameras/skills', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ snapshotId, skill: selected }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? parseResponse(payload) : null;
      if (!parsed) {
        setError(safeError(payload));
        return;
      }
      setExecution(parsed);
    } catch {
      setError('CAMERA_SKILL_UNAVAILABLE');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-3 rounded-xl border border-black bg-white p-3 text-black">
      <label className="block text-sm font-semibold text-black">
        {copy.visionSkill}
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value as VisionSkillName)}
          disabled={loading}
          className="ui-field mt-2 min-h-11 w-full rounded-xl px-3"
        >
          {VISION_SKILL_NAMES.map((name) => <option key={name} value={name}>{labels[name]}</option>)}
        </select>
      </label>
      <button
        type="button"
        onClick={() => void runSkill()}
        disabled={loading}
        className="ui-button-primary mt-3 min-h-11 rounded-xl px-4 font-semibold disabled:cursor-not-allowed"
      >
        {loading ? copy.runningSkill : copy.runSkill}
      </button>
      <p className="mt-2 text-xs text-zinc-800">{copy.skillHumanJudgment}</p>
      {error ? (
        <p role="alert" className="ui-alert ui-alert-error mt-3 break-all rounded-xl p-3 text-xs">
          {copy.skillFailed} · {error}
        </p>
      ) : null}
      {execution ? (
        <div className="mt-3 space-y-3" aria-live="polite">
          <div>
            <h4 className="font-semibold text-black">{copy.skillResult}</h4>
            <p className="mt-1 text-sm text-zinc-900">{execution.inspection.result.scene.summary}</p>
            <p className="mt-1 text-xs text-zinc-700">
              {labels[execution.skill.skillName]} · {Math.round(execution.skill.confidence * 100)}% · {execution.inspection.processingDurationMs} ms
            </p>
          </div>
          <pre className="ui-inverse max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white bg-black p-3 text-xs text-white">
            {JSON.stringify(execution.skill, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
