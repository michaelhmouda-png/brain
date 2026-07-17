'use client';

import { useEffect, useState } from 'react';

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

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('open');

  useEffect(() => {
    async function loadIncidents() {
      try {
        const res = await fetch(`/api/incidents?status=${filter}`);
        const data = await res.json();
        setIncidents(data);
      } catch (error) {
        console.error('Error loading incidents:', error);
      } finally {
        setLoading(false);
      }
    }

    loadIncidents();
  }, [filter]);

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Incident Reports</h1>
          <p className="text-gray-600 mt-2">Track and manage incident reports</p>
        </div>
        <button className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
          Report Incident
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 flex gap-2">
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
            <div key={incident.id} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow border-l-4 border-red-500">
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900">{incident.title}</h3>
                  <p className="text-gray-600 mt-1">{incident.description}</p>
                  <div className="text-sm text-gray-600 mt-2">
                    <div>Location: {incident.location}</div>
                    <div>Type: {incident.incident_type}</div>
                    <div>Reported: {new Date(incident.incident_time).toLocaleString()}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getSeverityColor(incident.severity)}`}>
                    {incident.severity}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(incident.status)}`}>
                    {incident.status}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <div className="text-sm text-gray-600">
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
