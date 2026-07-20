'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchJsonCollection, logRouteDiagnostic } from '@/lib/client-api';

interface DashboardWidget {
  label: string;
  count: number;
  href: string;
  color: string;
}

export default function OperationsDashboard() {
  const [widgets, setWidgets] = useState<DashboardWidget[]>([]);
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    async function loadDashboardData() {
      setLoading(true);
      setWarning(null);
      try {
        const sources = [
          { label: 'Scheduled Shifts', href: '/dashboard/shifts', color: 'from-green-500 to-green-600', api: '/api/shifts?type=list' },
          { label: 'Maintenance Issues', href: '/dashboard/maintenance', color: 'from-orange-500 to-orange-600', api: '/api/maintenance?status=open' },
          { label: 'Announcements', href: '/dashboard/announcements', color: 'from-purple-500 to-purple-600', api: '/api/announcements' },
          { label: 'Open Incidents', href: '/dashboard/incidents', color: 'from-red-500 to-red-600', api: '/api/incidents?status=open' },
        ] as const;
        const results = await Promise.allSettled(
          sources.map((source) => fetchJsonCollection('Operations', source.api, controller.signal))
        );
        if (!active) return;
        const nextWidgets: DashboardWidget[] = [];
        let failed = 0;
        results.forEach((result, index) => {
          const source = sources[index];
          if (result.status === 'fulfilled') {
            nextWidgets.push({ ...source, count: result.value.length });
          } else {
            failed += 1;
            logRouteDiagnostic(`Operations:${source.label}`, result.reason);
          }
        });
        setWidgets(nextWidgets);
        if (failed > 0) setWarning('Some operational totals are temporarily unavailable.');
      } catch (error) {
        if (!active) return;
        logRouteDiagnostic('Operations', error);
        setWidgets([]);
        setWarning('Operational totals are temporarily unavailable.');
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    loadDashboardData();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [retryKey]);

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Operations Dashboard</h1>
        <p className="mt-2 text-slate-300">Welcome to HospiBrain Operations Platform</p>
      </div>

      {warning && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-4 text-amber-100 sm:flex-row sm:items-center sm:justify-between" role="status">
          <span>{warning}</span>
          <button onClick={() => setRetryKey((value) => value + 1)} className="min-h-11 rounded-lg border border-amber-200/30 px-4 py-2 font-semibold">Retry</button>
        </div>
      )}

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
      <div className="rounded-lg bg-white p-6 text-slate-900 shadow">
        <h2 className="mb-4 text-xl font-bold text-slate-950">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <Link href="/dashboard/tasks" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center text-slate-900">
            <div className="text-2xl mb-2">✓</div>
            <div className="text-sm font-medium">Create Task</div>
          </Link>
          <Link href="/dashboard/shifts" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center text-slate-900">
            <div className="text-2xl mb-2">📅</div>
            <div className="text-sm font-medium">Schedule Shift</div>
          </Link>
          <Link href="/dashboard/maintenance" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center text-slate-900">
            <div className="text-2xl mb-2">🔧</div>
            <div className="text-sm font-medium">Report Maintenance</div>
          </Link>
          <Link href="/dashboard/announcements" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center text-slate-900">
            <div className="text-2xl mb-2">📢</div>
            <div className="text-sm font-medium">New Announcement</div>
          </Link>
          <Link href="/dashboard/incidents" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center text-slate-900">
            <div className="text-2xl mb-2">⚠️</div>
            <div className="text-sm font-medium">Report Incident</div>
          </Link>
          <Link href="/dashboard/settings" className="p-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-center text-slate-900">
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
