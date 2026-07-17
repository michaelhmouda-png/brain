'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DashboardWidget {
  label: string;
  count: number;
  href: string;
  color: string;
}

export default function OperationsDashboard() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        // Load counts for each widget
        const [tasksRes, shiftsRes, maintenanceRes, announcementsRes, incidentsRes] = await Promise.all([
          fetch('/api/tasks?status=open'),
          fetch('/api/shifts?type=schedules'),
          fetch('/api/maintenance?status=open'),
          fetch('/api/announcements'),
          fetch('/api/incidents?status=open'),
        ]);

        const tasks = (await tasksRes.json()).length || 0;
        const shifts = (await shiftsRes.json()).length || 0;
        const maintenance = (await maintenanceRes.json()).length || 0;
        const announcements = (await announcementsRes.json()).length || 0;
        const incidents = (await incidentsRes.json()).length || 0;

        setWidgets([
          { label: 'Open Tasks', count: tasks, href: '/dashboard/tasks', color: 'from-blue-500 to-blue-600' },
          { label: "Today's Shifts", count: shifts, href: '/dashboard/shifts', color: 'from-green-500 to-green-600' },
          { label: 'Maintenance Issues', count: maintenance, href: '/dashboard/maintenance', color: 'from-orange-500 to-orange-600' },
          { label: 'Announcements', count: announcements, href: '/dashboard/announcements', color: 'from-purple-500 to-purple-600' },
          { label: 'Open Incidents', count: incidents, href: '/dashboard/incidents', color: 'from-red-500 to-red-600' },
        ]);
      } catch (error) {
        console.error('Error loading dashboard:', error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Operations Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome to HospiBrain Operations Platform</p>
      </div>

      {/* Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {widgets.map((widget) => (
          <Link key={widget.href} href={widget.href}>
            <div className={`bg-gradient-to-br ${widget.color} rounded-lg shadow-lg p-6 text-white cursor-pointer hover:shadow-xl transition-shadow`}>
              <div className="text-3xl font-bold mb-2">{widget.count}</div>
              <div className="text-sm opacity-90">{widget.label}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Link href="/dashboard/tasks/new" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center">
            <div className="text-2xl mb-2">✓</div>
            <div className="text-sm font-medium">Create Task</div>
          </Link>
          <Link href="/dashboard/shifts" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center">
            <div className="text-2xl mb-2">📅</div>
            <div className="text-sm font-medium">Schedule Shift</div>
          </Link>
          <Link href="/dashboard/maintenance/new" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center">
            <div className="text-2xl mb-2">🔧</div>
            <div className="text-sm font-medium">Report Maintenance</div>
          </Link>
          <Link href="/dashboard/announcements/new" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center">
            <div className="text-2xl mb-2">📢</div>
            <div className="text-sm font-medium">New Announcement</div>
          </Link>
          <Link href="/dashboard/incidents/new" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center">
            <div className="text-2xl mb-2">⚠️</div>
            <div className="text-sm font-medium">Report Incident</div>
          </Link>
          <Link href="/dashboard/settings" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center">
            <div className="text-2xl mb-2">⚙️</div>
            <div className="text-sm font-medium">Settings</div>
          </Link>
        </div>
      </div>

      {/* AI Assistant Card */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg shadow-lg p-6 text-white">
        <h2 className="text-xl font-bold mb-2">Need Help?</h2>
        <p className="mb-4">Ask the AI Assistant to schedule shifts, create tasks, and manage operations</p>
        <Link href="/dashboard/ai-assistant" className="inline-block bg-white text-indigo-600 px-4 py-2 rounded font-medium hover:bg-gray-100">
          Open AI Assistant
        </Link>
      </div>
    </div>
  );
}
