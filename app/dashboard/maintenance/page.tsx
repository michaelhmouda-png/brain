'use client';

import { useEffect, useState } from 'react';

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

export default function MaintenancePage() {
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('open');

  useEffect(() => {
    async function loadTickets() {
      try {
        const res = await fetch(`/api/maintenance?status=${filter}`);
        const data = await res.json();
        setTickets(data);
      } catch (error) {
        console.error('Error loading tickets:', error);
      } finally {
        setLoading(false);
      }
    }

    loadTickets();
  }, [filter]);

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
