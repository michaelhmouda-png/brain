'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AlertCircle, Plus, RefreshCw, X } from 'lucide-react';
import {
  ClientApiError,
  fetchJsonCollection,
  isRecord,
  logRouteDiagnostic,
  stringField,
  userFacingRouteError,
} from '@/lib/client-api';

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  location: string;
  incident_time: string;
  incident_type: string;
  reported_by?: { full_name: string };
}

type IncidentForm = {
  title: string;
  description: string;
  incidentType: string;
  severity: string;
  affectedArea: string;
  incidentTime: string;
};

const emptyForm = (): IncidentForm => ({
  title: '',
  description: '',
  incidentType: '',
  severity: 'medium',
  affectedArea: '',
  incidentTime: '',
});

function localDateTimeNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function normalizeIncident(value: unknown): Incident | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  if (!id) return null;
  const locationRelation = Array.isArray(value.location) ? value.location[0] : value.location;
  const reporterRelation = Array.isArray(value.reported_by) ? value.reported_by[0] : value.reported_by;
  return {
    id,
    title: stringField(value, 'title') || 'Untitled incident',
    description: stringField(value, 'description'),
    severity: stringField(value, 'severity') || 'medium',
    status: stringField(value, 'status') || 'open',
    location: isRecord(locationRelation)
      ? stringField(locationRelation, 'name')
      : stringField(value, 'affected_area'),
    incident_time: stringField(value, 'incident_time'),
    incident_type: stringField(value, 'incident_type'),
    reported_by: isRecord(reporterRelation)
      ? { full_name: stringField(reporterRelation, 'full_name') }
      : undefined,
  };
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorizationError, setAuthorizationError] = useState(false);
  const [filter, setFilter] = useState('all');
  const [reporting, setReporting] = useState(false);
  const [form, setForm] = useState<IncidentForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadIncidents = useCallback(async (signal?: AbortSignal) => {
    const controller = signal ? null : new AbortController();
    setLoading(true);
    setError(null);
    setAuthorizationError(false);
    try {
      const statusQuery = filter === 'all' ? '' : `?status=${encodeURIComponent(filter)}`;
      const data = await fetchJsonCollection('Incidents', `/api/incidents${statusQuery}`, signal ?? controller!.signal);
      const normalized = data.map(normalizeIncident).filter((item): item is Incident => item !== null);
      setIncidents(normalized);
    } catch (loadError) {
      if (signal?.aborted || controller?.signal.aborted) return;
      logRouteDiagnostic('Incidents', loadError);
      const status = loadError instanceof ClientApiError ? loadError.diagnostic.status : undefined;
      setAuthorizationError(status === 401 || status === 403);
      setError(userFacingRouteError(loadError));
      setIncidents([]);
    } finally {
      if (!signal?.aborted && !controller?.signal.aborted) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => loadIncidents(controller.signal));
    return () => controller.abort();
  }, [loadIncidents]);

  async function submitIncident(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/incidents', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'create', data: form }),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) throw new Error('INVALID_INCIDENT_RESPONSE');
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Incident creation failed';
        throw new Error(message);
      }
      const created = normalizeIncident(payload);
      if (!created) throw new Error('INVALID_INCIDENT_RESPONSE');
      setIncidents((current) => [created, ...current.filter((incident) => incident.id !== created.id)]);
      setForm(emptyForm());
      setReporting(false);
      setFilter('all');
      setSuccess('Incident reported successfully.');
      await loadIncidents();
    } catch (creationError) {
      setSubmitError(creationError instanceof Error ? creationError.message : 'Incident creation failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const severityColor = (severity: string) => severity === 'critical'
    ? 'bg-red-100 text-red-800'
    : severity === 'high' ? 'bg-orange-100 text-orange-800'
      : severity === 'medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800';

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div><h1 className="text-3xl font-bold text-gray-900">Incident Reports</h1><p className="mt-2 text-gray-600">Live company incident records</p></div>
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" onClick={() => void loadIncidents()} disabled={loading} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 font-semibold text-gray-900 disabled:opacity-60 sm:flex-none"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" onClick={() => { setForm((current) => ({ ...current, incidentTime: current.incidentTime || localDateTimeNow() })); setReporting(true); setSubmitError(null); setSuccess(null); }} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 font-semibold text-white hover:bg-red-700 sm:flex-none"><Plus className="h-4 w-4" />Report incident</button>
        </div>
      </div>

      {success && <div className="rounded-xl border border-green-300 bg-green-50 p-4 text-green-900" role="status">{success}</div>}

      <div className="mobile-scroll-region flex gap-2 overflow-x-auto rounded-lg bg-white p-3 shadow" aria-label="Incident status filters">
        {['all', 'open', 'investigating', 'resolved', 'closed'].map((status) => <button type="button" key={status} onClick={() => setFilter(status)} className={`min-h-11 rounded px-4 font-medium capitalize ${filter === status ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}>{status}</button>)}
      </div>

      {loading && incidents.length === 0 && <div className="space-y-3" role="status" aria-label="Loading incidents">{[1, 2, 3].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-white/60" />)}</div>}
      {!loading && error && <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-6 text-center text-red-100" role="alert"><AlertCircle className="mx-auto h-6 w-6" /><p className="mt-2">{error}</p>{!authorizationError && <button type="button" onClick={() => void loadIncidents()} className="mt-4 min-h-11 rounded-lg bg-white px-4 font-semibold text-slate-900">Try again</button>}</div>}
      {!loading && !error && incidents.length === 0 && <div className="rounded-xl bg-white p-8 text-center text-gray-600">No incidents have been reported for this view.</div>}

      {!error && incidents.length > 0 && <div className="space-y-4">{incidents.map((incident) => <article key={incident.id} className="rounded-lg border-l-4 border-red-500 bg-white p-4 shadow sm:p-6"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div className="min-w-0"><h2 className="break-words text-lg font-bold text-gray-900">{incident.title}</h2><p className="mt-1 break-words text-gray-600">{incident.description}</p><dl className="mt-3 space-y-1 text-sm text-gray-600"><div>Location: {incident.location || 'Not specified'}</div><div>Type: {incident.incident_type ? incident.incident_type.replaceAll('_', ' ') : 'Not specified'}</div><div>Reported: {incident.incident_time ? new Date(incident.incident_time).toLocaleString() : 'Unknown'}</div><div>Reported by: {incident.reported_by?.full_name || 'Current team member'}</div></dl></div><div className="flex flex-wrap gap-2 sm:flex-col"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityColor(incident.severity)}`}>{incident.severity}</span><span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-800">{incident.status}</span></div></div></article>)}</div>}

      {reporting && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="incident-form-title"><div className="max-h-[100dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-6"><div className="flex items-center justify-between"><h2 id="incident-form-title" className="text-xl font-bold text-gray-950">Report an incident</h2><button type="button" aria-label="Close incident form" onClick={() => setReporting(false)} className="flex h-11 w-11 items-center justify-center rounded-full text-gray-700 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
        <form onSubmit={submitIncident} className="mt-5 space-y-4">
          <label className="block text-sm font-semibold text-gray-900">Title<input required maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" /></label>
          <label className="block text-sm font-semibold text-gray-900">Description<textarea required maxLength={5000} rows={4} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-300 p-3 text-base" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-gray-900">Type<select value={form.incidentType} onChange={(event) => setForm((current) => ({ ...current, incidentType: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base"><option value="">Not specified</option>{['guest_injury', 'employee_injury', 'fight', 'power_outage', 'equipment_failure', 'lost_item', 'other'].map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label><label className="block text-sm font-semibold text-gray-900">Severity<select value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base">{['low', 'medium', 'high', 'critical'].map((severity) => <option key={severity} value={severity}>{severity}</option>)}</select></label></div>
          <label className="block text-sm font-semibold text-gray-900">Affected area (optional)<input maxLength={500} value={form.affectedArea} onChange={(event) => setForm((current) => ({ ...current, affectedArea: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" /></label>
          <label className="block text-sm font-semibold text-gray-900">Incident time<input required type="datetime-local" value={form.incidentTime} onChange={(event) => setForm((current) => ({ ...current, incidentTime: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-gray-300 px-3 text-base" /></label>
          {submitError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{submitError}</div>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setReporting(false)} disabled={submitting} className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold text-gray-900">Cancel</button><button type="submit" disabled={submitting} className="min-h-11 rounded-lg bg-red-600 px-5 font-semibold text-white disabled:opacity-60">{submitting ? 'Reporting…' : 'Report incident'}</button></div>
        </form></div></div>}
    </div>
  );
}
