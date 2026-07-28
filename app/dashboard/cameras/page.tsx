'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, Plus, RefreshCw, Server, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { BrainAgentManager } from '@/components/camera-manager/BrainAgentManager';
import { CameraSnapshotControl } from '@/components/camera-manager/CameraSnapshotControl';
import { NvrProbeControls } from '@/components/camera-manager/NvrProbeControls';
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge';

type Location = { id: string; name: string; status: string };
type Gateway = { id: string; location_id: string | null; name: string; status: string };
type Nvr = { id: string; location_id: string; gateway_id: string | null; name: string; vendor: string; local_host: string; http_port: number | null; rtsp_port: number | null; onvif_port: number | null; status: string; last_tested_at: string | null };
type ManagedCamera = { id: string; location_id: string; nvr_connection_id: string; external_channel_id: string; name: string; area: string | null; department: string | null; status: string; ai_enabled: boolean; task_verification_enabled: boolean; last_seen_at: string | null };
type NvrForm = { id?: string; locationId: string; gatewayId: string; name: string; vendor: string; localHost: string; httpPort: string; rtspPort: string; onvifPort: string; usernameSecretReference: string; passwordSecretReference: string; status: 'unconfigured' | 'configured' };

const emptyForm: NvrForm = { locationId: '', gatewayId: '', name: '', vendor: 'Dahua', localHost: '', httpPort: '80', rtspPort: '554', onvifPort: '', usernameSecretReference: '', passwordSecretReference: '', status: 'unconfigured' };
const jsonContent = (response: Response) => response.headers.get('content-type')?.includes('application/json') === true;

function parseList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function deviceStatusTone(status: string): StatusTone {
  if (['online', 'active', 'configured', 'succeeded'].includes(status)) return 'success';
  if (['offline', 'disabled'].includes(status)) return 'offline';
  if (['error', 'failed'].includes(status)) return 'failed';
  if (['unconfigured', 'pending'].includes(status)) return 'pending';
  return 'info';
}

export default function CamerasPage() {
  const { messages: t, language, role } = useLocale();
  const c = t.cameras;
  const [nvrs, setNvrs] = useState<Nvr[]>([]);
  const [cameras, setCameras] = useState<ManagedCamera[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [locationId, setLocationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NvrForm | null>(null);
  const [editingCamera, setEditingCamera] = useState<ManagedCamera | null>(null);
  const [saving, setSaving] = useState(false);
  const canManageNvrs = role === 'owner' || role === 'super_admin';

  useEffect(() => {
    const selectedLocation = locations.find((item) => item.id === locationId);
    window.dispatchEvent(new CustomEvent('brain:context', {
      detail: {
        view: 'Camera Manager',
        location: selectedLocation?.name || 'All authorized locations',
      },
    }));
  }, [locationId, locations]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nvrResponse, cameraResponse, agentResponse] = await Promise.all([
        fetch('/api/devices/nvrs', { cache: 'no-store', headers: { Accept: 'application/json' } }),
        fetch(`/api/devices/cameras${locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''}`, { cache: 'no-store', headers: { Accept: 'application/json' } }),
        fetch('/api/devices/agents', { cache: 'no-store', headers: { Accept: 'application/json' } }),
      ]);
      if ([nvrResponse, cameraResponse, agentResponse].some((response) => response.status === 401 || response.status === 403)) { setError(c.unauthorized); return; }
      if (!nvrResponse.ok || !cameraResponse.ok || !agentResponse.ok || !jsonContent(nvrResponse) || !jsonContent(cameraResponse) || !jsonContent(agentResponse)) throw new Error('request');
      const nvrPayload: unknown = await nvrResponse.json();
      const cameraPayload: unknown = await cameraResponse.json();
      const agentPayload: unknown = await agentResponse.json();
      const nvrData = typeof nvrPayload === 'object' && nvrPayload !== null && !Array.isArray(nvrPayload) ? (nvrPayload as { data?: unknown }).data : null;
      const nvrObject = typeof nvrData === 'object' && nvrData !== null && !Array.isArray(nvrData) ? nvrData as { nvrs?: unknown; locations?: unknown } : {};
      const cameraData = typeof cameraPayload === 'object' && cameraPayload !== null && !Array.isArray(cameraPayload) ? (cameraPayload as { data?: unknown }).data : null;
      const agentData = typeof agentPayload === 'object' && agentPayload !== null && !Array.isArray(agentPayload) ? (agentPayload as { data?: unknown }).data : null;
      const agentObject = typeof agentData === 'object' && agentData !== null && !Array.isArray(agentData) ? agentData as { gateways?: unknown } : {};
      setNvrs(parseList(nvrObject.nvrs) as Nvr[]); setLocations(parseList(nvrObject.locations) as Location[]); setCameras(parseList(cameraData) as ManagedCamera[]); setGateways(parseList(agentObject.gateways) as Gateway[]);
    } catch { setError(c.unavailable); }
    finally { setLoading(false); }
  }, [c.unauthorized, c.unavailable, locationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visibleNvrs = locationId ? nvrs.filter((nvr) => nvr.location_id === locationId) : nvrs;
  const summary = useMemo(() => ({ total: cameras.length, online: cameras.filter((item) => item.status === 'online').length, offline: cameras.filter((item) => item.status === 'offline' || item.status === 'error').length, ai: cameras.filter((item) => item.ai_enabled).length }), [cameras]);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? c.unknownLocation;
  const nvrName = (id: string) => nvrs.find((item) => item.id === id)?.name ?? c.unknownNvr;
  const gatewayName = (id: string | null) => id ? gateways.find((item) => item.id === id)?.name ?? c.unassigned : c.unassigned;

  async function saveNvr(event: React.FormEvent) {
    event.preventDefault(); if (!form) return; setSaving(true); setError(null);
    const payload = { ...form, gatewayId: form.gatewayId || null, httpPort: form.httpPort ? Number(form.httpPort) : null, rtspPort: form.rtspPort ? Number(form.rtspPort) : null, onvifPort: form.onvifPort ? Number(form.onvifPort) : null };
    try {
      const response = await fetch('/api/devices/nvrs', { method: form.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok || !jsonContent(response)) throw new Error('save');
      setForm(null); await load();
    } catch { setError(c.saveFailed); } finally { setSaving(false); }
  }

  async function removeNvr(id: string) {
    if (!window.confirm(c.removeConfirm)) return; setSaving(true); setError(null);
    try {
      const response = await fetch('/api/devices/nvrs', { method: 'DELETE', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id }) });
      if (!response.ok) throw new Error('delete'); await load();
    } catch { setError(c.removeFailed); } finally { setSaving(false); }
  }

  async function saveCamera(event: React.FormEvent) {
    event.preventDefault(); if (!editingCamera) return; setSaving(true); setError(null);
    try {
      const response = await fetch('/api/devices/cameras', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ id: editingCamera.id, name: editingCamera.name, area: editingCamera.area, department: editingCamera.department, aiEnabled: editingCamera.ai_enabled, taskVerificationEnabled: editingCamera.task_verification_enabled }) });
      if (!response.ok || !jsonContent(response)) throw new Error('save'); setEditingCamera(null); await load();
    } catch { setError(c.saveFailed); } finally { setSaving(false); }
  }

  return <section dir={language === 'ar' ? 'rtl' : 'ltr'} className="space-y-6 px-4 pb-8 sm:px-6 lg:px-0">
    <header className="flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:flex-row sm:items-end sm:justify-between sm:p-7">
      <div><p className="text-sm uppercase tracking-[0.25em] text-cyan-300">{c.eyebrow}</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">{c.title}</h1><p className="mt-2 max-w-2xl text-sm text-slate-300">{c.description}</p></div>
      <div className="flex flex-wrap gap-2"><select aria-label={c.location} value={locationId} onChange={(event) => setLocationId(event.target.value)} className="ui-field min-h-11 rounded-xl px-3 text-sm"><option value="">{c.allLocations}</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{canManageNvrs && <button onClick={() => setForm({ ...emptyForm, locationId: locationId || locations[0]?.id || '' })} className="ui-button-primary flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold"><Plus className="h-4 w-4" />{c.addNvr}</button>}<button onClick={() => void load()} aria-label={c.refresh} className="ui-button-secondary flex h-11 w-11 items-center justify-center rounded-xl"><RefreshCw className="h-4 w-4" /></button></div>
    </header>
    {error && <div role="alert" className="ui-alert ui-alert-error flex items-center justify-between rounded-2xl p-4"><span>{error}</span><button onClick={() => void load()} className="ui-button-secondary min-h-11 rounded-xl px-3 font-semibold">{c.retry}</button></div>}
    <BrainAgentManager locationId={locationId} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[[c.total,summary.total],[c.online,summary.online],[c.offline,summary.offline],[c.aiEnabled,summary.ai]].map(([label,value]) => <article key={String(label)} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-black">{value}</p></article>)}</div>
    {loading ? <div className="rounded-3xl border border-white/10 p-8 text-center text-slate-300">{c.loading}</div> : <>
      <div>
        <h2 className="mb-3 text-xl font-bold">{c.nvrs}</h2>
        {visibleNvrs.length === 0 ? <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-slate-400"><Server className="mx-auto mb-3 h-8 w-8" />{locations.length === 0 ? c.noLocations : c.noNvrs}</div> : <div className="grid gap-3 lg:grid-cols-2">{visibleNvrs.map((nvr) => <article key={nvr.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-5"><div className="flex justify-between gap-3"><div><h3 className="font-bold">{nvr.name}</h3><p className="text-sm text-slate-400">{nvr.vendor} · {locationName(nvr.location_id)}</p></div><StatusBadge tone={deviceStatusTone(nvr.status)} label={c.status[nvr.status as keyof typeof c.status] ?? nvr.status} /></div><dl className="mt-4 grid grid-cols-2 gap-2 text-sm"><dt className="text-slate-500">{c.localHost}</dt><dd>{nvr.local_host}</dd><dt className="text-slate-500">{t.agents.title}</dt><dd>{gatewayName(nvr.gateway_id)}</dd><dt className="text-slate-500">{c.cameras}</dt><dd>{cameras.filter((item) => item.nvr_connection_id === nvr.id).length}</dd><dt className="text-slate-500">{c.lastTested}</dt><dd>{nvr.last_tested_at ? new Intl.DateTimeFormat(language).format(new Date(nvr.last_tested_at)) : c.never}</dd></dl><p className="ui-alert ui-alert-warning mt-4 rounded-xl p-3 text-xs">{c.agentNotice}</p>{canManageNvrs && <NvrProbeControls nvrConnectionId={nvr.id} />}{canManageNvrs && <div className="mt-4 flex gap-2"><button onClick={() => setForm({ id:nvr.id,locationId:nvr.location_id,gatewayId:nvr.gateway_id??'',name:nvr.name,vendor:nvr.vendor,localHost:nvr.local_host,httpPort:String(nvr.http_port??''),rtspPort:String(nvr.rtsp_port??''),onvifPort:String(nvr.onvif_port??''),usernameSecretReference:'',passwordSecretReference:'',status:nvr.status === 'configured' ? 'configured' : 'unconfigured' })} className="ui-button-secondary min-h-11 rounded-xl px-4">{c.edit}</button><button onClick={() => void removeNvr(nvr.id)} disabled={saving} className="ui-button-destructive min-h-11 rounded-xl px-4">{c.remove}</button></div>}</article>)}</div>}
      </div>
      <div><h2 className="mb-3 text-xl font-bold">{c.cameras}</h2>{cameras.length === 0 ? <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-slate-400"><Camera className="mx-auto mb-3 h-8 w-8" />{c.noCameras}</div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{cameras.map((item) => <article key={item.id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-5"><div className="flex justify-between gap-3"><h3 className="font-bold">{item.name}</h3><span className="text-xs text-slate-400">{c.channel} {item.external_channel_id}</span></div><p className="mt-2 text-sm text-slate-400">{locationName(item.location_id)} · {nvrName(item.nvr_connection_id)}</p><p className="mt-2 text-sm">{item.area || c.unassigned} / {item.department || c.unassigned}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><StatusBadge tone={deviceStatusTone(item.status)} label={c.status[item.status as keyof typeof c.status] ?? item.status} />{item.ai_enabled && <StatusBadge tone="info" label={c.aiEnabled} />}{item.task_verification_enabled && <StatusBadge tone="review" label={c.taskVerification} />}</div><button onClick={() => setEditingCamera({ ...item })} className="ui-button-secondary mt-4 min-h-11 rounded-xl px-4">{c.edit}</button>{canManageNvrs && nvrs.find((nvr) => nvr.id === item.nvr_connection_id)?.gateway_id ? <CameraSnapshotControl gatewayId={nvrs.find((nvr) => nvr.id === item.nvr_connection_id)!.gateway_id!} nvrConnectionId={item.nvr_connection_id} channelId={item.external_channel_id} /> : null}</article>)}</div>}</div>
    </>}
    {form && <div role="dialog" aria-modal="true" aria-labelledby="nvr-title" className="ui-overlay fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center">
      <form onSubmit={saveNvr} className="ui-management-surface max-h-[calc(100dvh-1.5rem)] w-full max-w-xl overflow-y-auto rounded-3xl border p-5">
        <div className="flex justify-between">
          <h2 id="nvr-title" className="text-xl font-bold">{form.id ? c.editNvr : c.addNvr}</h2>
          <button type="button" onClick={() => setForm(null)} aria-label={c.close} className="h-11 w-11"><X className="mx-auto" /></button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label>{c.location}
            <select required value={form.locationId} onChange={(event) => {
              const nextLocationId = event.target.value;
              const gatewayStillMatches = gateways.some((gateway) => gateway.id === form.gatewayId && (gateway.location_id === null || gateway.location_id === nextLocationId));
              setForm({ ...form, locationId: nextLocationId, gatewayId: gatewayStillMatches ? form.gatewayId : '' });
            }} className="ui-field mt-1 min-h-11 w-full rounded-xl px-3">
              {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>{t.agents.title}
            <select value={form.gatewayId} onChange={(event) => setForm({ ...form, gatewayId: event.target.value })} className="ui-field mt-1 min-h-11 w-full rounded-xl px-3">
              <option value="">{c.unassigned}</option>
              {gateways.filter((gateway) => gateway.location_id === null || gateway.location_id === form.locationId).map((gateway) =>
                <option key={gateway.id} value={gateway.id}>{gateway.name} · {t.agents.status[gateway.status as keyof typeof t.agents.status] ?? gateway.status}</option>
              )}
            </select>
          </label>
          {(['name','vendor','localHost'] as const).map((key) => <label key={key}>{c[key]}<input required value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="ui-field mt-1 min-h-11 w-full rounded-xl px-3" /></label>)}
          {(['httpPort','rtspPort','onvifPort'] as const).map((key) => <label key={key}>{c[key]}<input type="number" min="1" max="65535" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="ui-field mt-1 min-h-11 w-full rounded-xl px-3" /></label>)}
          {(['usernameSecretReference','passwordSecretReference'] as const).map((key) => <label key={key}>{c[key]}<input value={form[key]} autoComplete="off" onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="ui-field mt-1 min-h-11 w-full rounded-xl px-3" /></label>)}
        </div>
        <p className="mt-3 text-xs text-amber-200">{c.secretNotice}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setForm(null)} className="ui-button-secondary min-h-11 rounded-xl px-4">{c.cancel}</button>
          <button disabled={saving || locations.length === 0} className="ui-button-primary min-h-11 rounded-xl px-5 font-semibold">{saving ? c.saving : c.save}</button>
        </div>
      </form>
    </div>}
    {editingCamera && <div role="dialog" aria-modal="true" className="ui-overlay fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center"><form onSubmit={saveCamera} className="ui-management-surface w-full max-w-lg rounded-3xl border p-5"><h2 className="text-xl font-bold">{c.editCamera}</h2>{(['name','area','department'] as const).map((key)=><label key={key} className="mt-3 block">{c[key]}<input required={key==='name'} value={editingCamera[key]??''} onChange={(e)=>setEditingCamera({...editingCamera,[key]:e.target.value||null})} className="ui-field mt-1 min-h-11 w-full rounded-xl px-3" /></label>)}<label className="mt-4 flex min-h-11 items-center gap-3"><input type="checkbox" checked={editingCamera.ai_enabled} onChange={(e)=>setEditingCamera({...editingCamera,ai_enabled:e.target.checked})}/>{c.aiEnabled}</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={editingCamera.task_verification_enabled} onChange={(e)=>setEditingCamera({...editingCamera,task_verification_enabled:e.target.checked})}/>{c.taskVerification}</label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={()=>setEditingCamera(null)} className="ui-button-secondary min-h-11 rounded-xl px-4">{c.cancel}</button><button disabled={saving} className="ui-button-primary min-h-11 rounded-xl px-5 font-semibold">{saving?c.saving:c.save}</button></div></form></div>}
  </section>;
}
