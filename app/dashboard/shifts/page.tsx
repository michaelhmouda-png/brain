'use client';

import { useEffect, useState } from 'react';

interface Schedule {
  id: string;
  employee_id: string;
  week_start_date: string;
  monday_shift_id?: string;
  employee?: { first_name: string; last_name: string };
}

export default function ShiftsPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState<string>(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    async function loadSchedules() {
      try {
        const res = await fetch(`/api/shifts?type=schedules&weekStart=${weekStart}`);
        const data = await res.json();
        setSchedules(data);
      } catch (error) {
        console.error('Error loading schedules:', error);
      } finally {
        setLoading(false);
      }
    }

    loadSchedules();
  }, [weekStart]);

  const handleWeekChange = (days: number) => {
    const newDate = new Date(weekStart);
    newDate.setDate(newDate.getDate() + days);
    setWeekStart(newDate.toISOString().split('T')[0]);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading schedules...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Shift Management</h1>
        <p className="text-gray-600 mt-2">View and manage weekly schedules, recurring shifts, and attendance</p>
      </div>

      {/* Week Navigator */}
      <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between">
        <button
          onClick={() => handleWeekChange(-7)}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
        >
          ← Previous Week
        </button>
        <div className="text-lg font-semibold">
          Week of {new Date(weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
        <button
          onClick={() => handleWeekChange(7)}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
        >
          Next Week →
        </button>
      </div>

      {/* Schedules Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-100 border-b">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Employee</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Monday</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Tuesday</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Wednesday</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Thursday</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Friday</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Saturday</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">Sunday</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {schedules.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                  No schedules for this week
                </td>
              </tr>
            ) : (
              schedules.map((schedule) => (
                <tr key={schedule.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">
                    {schedule.employee?.first_name} {schedule.employee?.last_name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {schedule.monday_shift_id ? '9 AM - 5 PM' : '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">—</td>
                  <td className="px-6 py-4 text-sm text-gray-600">—</td>
                  <td className="px-6 py-4 text-sm text-gray-600">—</td>
                  <td className="px-6 py-4 text-sm text-gray-600">—</td>
                  <td className="px-6 py-4 text-sm text-gray-600">—</td>
                  <td className="px-6 py-4 text-sm text-gray-600">—</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <div className="text-2xl font-bold text-blue-900">{schedules.length}</div>
          <div className="text-sm text-blue-700">Employees Scheduled</div>
        </div>
        <div className="bg-green-50 rounded-lg p-4 border border-green-200">
          <div className="text-2xl font-bold text-green-900">0</div>
          <div className="text-sm text-green-700">Shift Swaps Pending</div>
        </div>
        <div className="bg-orange-50 rounded-lg p-4 border border-orange-200">
          <div className="text-2xl font-bold text-orange-900">0</div>
          <div className="text-sm text-orange-700">Time Off Requests</div>
        </div>
      </div>
    </div>
  );
}
