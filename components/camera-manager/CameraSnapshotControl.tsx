'use client';

import { useEffect, useState } from 'react';
import { CameraSkillControl } from '@/components/camera-manager/CameraSkillControl';

type CommandState = {
  commandId: string;
  status: string;
  attemptCount: number;
  result: Record<string, unknown> | null;
  errorCode: string | null;
};

type SnapshotAccess = {
  artifactId: string;
  contentType: 'image/jpeg';
  byteSize: number;
  width: number;
  height: number;
  expiresAt: string;
  signedUrl: string;
  signedUrlExpiresAt: string;
  signedUrlExpiresInSeconds: number;
};

const ACTIVE = new Set(['pending', 'leased']);

function validAccess(value: unknown): value is SnapshotAccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.artifactId === 'string'
    && item.contentType === 'image/jpeg'
    && typeof item.byteSize === 'number' && Number.isInteger(item.byteSize) && item.byteSize > 0
    && typeof item.width === 'number' && Number.isInteger(item.width) && item.width > 0
    && typeof item.height === 'number' && Number.isInteger(item.height) && item.height > 0
    && typeof item.expiresAt === 'string'
    && typeof item.signedUrl === 'string'
    && typeof item.signedUrlExpiresAt === 'string'
    && item.signedUrlExpiresInSeconds === 60;
}

export function CameraSnapshotControl({
  gatewayId,
  nvrConnectionId,
  channelId,
}: {
  gatewayId: string;
  nvrConnectionId: string;
  channelId: string;
}) {
  const [command, setCommand] = useState<CommandState | null>(null);
  const [access, setAccess] = useState<SnapshotAccess | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!command || !ACTIVE.has(command.status)) return;
    const timer = window.setInterval(async () => {
      const response = await fetch(
        `/api/devices/commands?id=${encodeURIComponent(command.commandId)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } },
      );
      const payload: unknown = await response.json().catch(() => null);
      const next = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (response.ok && next && typeof next === 'object' && !Array.isArray(next)) {
        setCommand(next as CommandState);
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [command]);

  useEffect(() => {
    const artifactId = command?.status === 'succeeded'
      && typeof command.result?.artifactId === 'string'
      ? command.result.artifactId
      : null;
    if (!artifactId || access) return;
    const load = async () => {
      const response = await fetch(
        `/api/devices/commands/snapshots?id=${encodeURIComponent(artifactId)}`,
        { cache: 'no-store', headers: { Accept: 'application/json' } },
      );
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (!response.ok || !validAccess(data)) {
        setError('SNAPSHOT_ACCESS_UNAVAILABLE');
        return;
      }
      setAccess(data);
    };
    void load();
  }, [access, command]);

  async function requestSnapshot() {
    if (command || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/devices/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          gatewayId,
          nvrConnectionId,
          commandType: 'snapshot_request',
          idempotencyKey: crypto.randomUUID(),
          request: { channelId },
          ttlSeconds: 120,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const data = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as { data?: unknown }).data
        : null;
      if (!response.ok || !data || typeof data !== 'object' || Array.isArray(data)
          || typeof (data as { commandId?: unknown }).commandId !== 'string') {
        throw new Error('SNAPSHOT_NOT_ENQUEUED');
      }
      setCommand({
        commandId: (data as { commandId: string }).commandId,
        status: String((data as { status?: unknown }).status ?? 'pending'),
        attemptCount: 0,
        result: null,
        errorCode: null,
      });
    } catch {
      setError('SNAPSHOT_NOT_ENQUEUED');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      <button
        type="button"
        onClick={() => void requestSnapshot()}
        disabled={submitting || command !== null}
        className="ui-button-secondary min-h-11 rounded-xl px-4 disabled:cursor-not-allowed"
      >
        Request JPEG snapshot
      </button>
      {command ? (
        <p className="mt-2 break-all text-xs text-slate-400">
          Request {command.commandId} · {command.status} · attempts {command.attemptCount}
          {command.errorCode ? ` · ${command.errorCode}` : ''}
        </p>
      ) : null}
      {error ? <p role="alert" className="ui-alert ui-alert-error mt-2 rounded-xl p-3 text-xs">{error}</p> : null}
      {access ? (
        <>
          <figure className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={access.signedUrl}
              alt={`Dahua channel ${channelId} snapshot`}
              width={access.width}
              height={access.height}
              className="h-auto w-full"
            />
            <figcaption className="space-y-1 p-3 text-xs text-slate-400">
              <p>{access.width}×{access.height} · {access.byteSize} bytes · JPEG</p>
              <p>Signed access expires {access.signedUrlExpiresAt}</p>
            </figcaption>
          </figure>
          <CameraSkillControl snapshotId={access.artifactId} />
        </>
      ) : null}
    </div>
  );
}
