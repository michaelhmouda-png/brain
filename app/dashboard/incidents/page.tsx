'use client';

import { useEffect, useState } from 'react';
import {
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
  reported_by?: { email: string };
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
    severity: stringField(value, 'severity') || 'low',
    status: stringField(value, 'status') || 'open',
    location: isRecord(locationRelation)
      ? stringField(locationRelation, 'name')
      : stringField(value, 'location') || stringField(value, 'affected_area'),
    incident_time: stringField(value, 'incident_time'),
    incident_type: stringField(value, 'incident_type'),
    reported_by: isRecord(reporterRelation)
      ? { email: stringField(reporterRelation, 'email') }
      : undefined,
  };
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [filter, setFilter] = useState<string>('open');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    async function loadIncidents() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJsonCollection(
          'Incidents',
          `/api/incidents?status=${encodeURIComponent(filter)}`,
          controller.signal
        );
        if (active) setIncidents(data.map(normalizeIncident).filter((item): item is Incident => item !== null));
      } catch (error) {
        if (!active) return;
        logRouteDiagnostic('Incidents', error);
        setIncidents([]);
        setError(userFacingRouteError(error));
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    loadIncidents();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filter, retryKey]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-green-100 text-green-800';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'resolved':
        return 'bg-green-100 text-green-800';
      case 'investigating':
        return 'bg-blue-100 text-blue-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-yellow-100 text-yellow-800';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading incidents...</div>;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-6 text-center text-red-100" role="alert">
        <p>{error}</p>
        <button onClick={() => setRetryKey((value) => value + 1)} className="mt-4 min-h-11 rounded-lg bg-white px-4 py-2 font-semibold text-slate-900">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Incident Reports</h1>
          <p className="text-gray-600 mt-2">Track and manage incident reports</p>
        </div>
        <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
          Report Incident
        </button>
      </div>

      {/* Filters */}
      <div className="mobile-scroll-region flex gap-2 overflow-x-auto rounded-lg bg-white p-4 shadow" aria-label="Incident status filters">
        {['open', 'investigating', 'resolved', 'closed'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded font-medium ${
              filter === status
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Incidents Grid */}
      <div className="space-y-4">
        {incidents.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-gray-500">
            No incidents in this category
          </div>
        ) : (
          incidents.map((incident) => (
            <div key={incident.id} className="rounded-lg border-l-4 border-red-500 bg-white p-4 shadow transition-shadow hover:shadow-lg sm:p-6">
              <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-gray-900">{incident.title}</h3>
                  <p className="text-gray-600 mt-1">{incident.description}</p>
                  <div className="text-sm text-gray-600 mt-2">
                    <div>Location: {incident.location}</div>
                    <div>Type: {incident.incident_type}</div>
                    <div>Reported: {new Date(incident.incident_time).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:flex-col">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getSeverityColor(incident.severity)}`}>
                    {incident.severity}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(incident.status)}`}>
                    {incident.status}
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="break-words text-sm text-gray-600">
                  Reported by: {incident.reported_by?.email || 'Unknown'}
                </div>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700">
                  View Details
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
