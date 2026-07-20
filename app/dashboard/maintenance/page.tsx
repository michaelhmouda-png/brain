'use client';

import { useEffect, useState } from 'react';
import {
  fetchJsonCollection,
  isRecord,
  logRouteDiagnostic,
  stringField,
  userFacingRouteError,
} from '@/lib/client-api';

interface MaintenanceTicket {
  id: string;
  title: string;
  priority: string;
  status: string;
  area: string;
  equipment: string;
  due_date: string;
  assigned_to?: { first_name: string; last_name: string };
}

function normalizeTicket(value: unknown): MaintenanceTicket | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  if (!id) return null;
  const relation = Array.isArray(value.assigned_to) ? value.assigned_to[0] : value.assigned_to;
  const assignedTo = isRecord(relation)
    ? { first_name: stringField(relation, 'first_name'), last_name: stringField(relation, 'last_name') }
    : undefined;
  return {
    id,
    title: stringField(value, 'title') || 'Untitled ticket',
    priority: stringField(value, 'priority') || 'low',
    status: stringField(value, 'status') || 'open',
    area: stringField(value, 'area') || stringField(value, 'affected_area'),
    equipment: stringField(value, 'equipment') || stringField(value, 'equipment_name'),
    due_date: stringField(value, 'due_date'),
    assigned_to: assignedTo,
  };
}

export default function MaintenancePage() {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [filter, setFilter] = useState<string>('open');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    async function loadTickets() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJsonCollection(
          'Maintenance',
          `/api/maintenance?status=${encodeURIComponent(filter)}`,
          controller.signal
        );
        if (active) setTickets(data.map(normalizeTicket).filter((item): item is MaintenanceTicket => item !== null));
      } catch (error) {
        if (!active) return;
        logRouteDiagnostic('Maintenance', error);
        setTickets([]);
        setError(userFacingRouteError(error));
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    loadTickets();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filter, retryKey]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
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
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'waiting_parts':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading maintenance tickets...</div>;
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
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Maintenance Management</h1>
        <p className="text-gray-600 mt-2">Track and manage maintenance tickets</p>
      </div>

      {/* Filters */}
      <div className="mobile-scroll-region flex gap-2 overflow-x-auto rounded-lg bg-white p-4 shadow" aria-label="Maintenance status filters">
        {['open', 'assigned', 'in_progress', 'completed'].map((status) => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-4 py-2 rounded font-medium ${
              filter === status
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
            }`}
          >
            {status.replace('_', ' ').charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Tickets List */}
      <div className="space-y-4">
        {tickets.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-gray-500">
            No maintenance tickets in this category
          </div>
        ) : (
          tickets.map((ticket) => (
            <div key={ticket.id} className="rounded-lg bg-white p-4 shadow transition-shadow hover:shadow-lg sm:p-6">
              <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900">{ticket.title}</h3>
                  <div className="text-sm text-gray-600 mt-1">
                    Area: {ticket.area} | Equipment: {ticket.equipment}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getPriorityColor(ticket.priority)}`}>
                    {ticket.priority}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(ticket.status)}`}>
                    {ticket.status.replace('_', ' ')}
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div className="text-sm text-gray-600">
                  {ticket.assigned_to ? (
                    <>Assigned to: {ticket.assigned_to.first_name} {ticket.assigned_to.last_name}</>
                  ) : (
                    <>Unassigned</>
                  )}
                </div>
                {ticket.due_date && (
                  <div className="text-sm text-gray-600">
                    Due: {new Date(ticket.due_date).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
