'use client';

import { useEffect, useState } from 'react';
import {
  fetchJsonCollection,
  isRecord,
  logRouteDiagnostic,
  stringField,
  userFacingRouteError,
} from '@/lib/client-api';

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: string;
  published_at: string;
  expires_at?: string;
  created_by?: { email: string };
}

function normalizeAnnouncement(value: unknown): Announcement | null {
  if (!isRecord(value)) return null;
  const id = stringField(value, 'id');
  if (!id) return null;
  const creatorRelation = Array.isArray(value.created_by) ? value.created_by[0] : value.created_by;
  return {
    id,
    title: stringField(value, 'title') || 'Untitled announcement',
    content: stringField(value, 'content'),
    priority: stringField(value, 'priority') || 'normal',
    published_at: stringField(value, 'published_at') || stringField(value, 'created_at'),
    expires_at: stringField(value, 'expires_at') || undefined,
    created_by: isRecord(creatorRelation)
      ? { email: stringField(creatorRelation, 'email') }
      : undefined,
  };
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    async function loadAnnouncements() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJsonCollection('Announcements', '/api/announcements', controller.signal);
        if (active) setAnnouncements(data.map(normalizeAnnouncement).filter((item): item is Announcement => item !== null));
      } catch (error) {
        if (!active) return;
        logRouteDiagnostic('Announcements', error);
        setAnnouncements([]);
        setError(userFacingRouteError(error));
      } finally {
        window.clearTimeout(timeout);
        if (active) setLoading(false);
      }
    }

    loadAnnouncements();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [retryKey]);

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'border-l-4 border-red-500 bg-red-50';
      case 'high':
        return 'border-l-4 border-orange-500 bg-orange-50';
      case 'normal':
        return 'border-l-4 border-blue-500 bg-blue-50';
      default:
        return 'border-l-4 border-gray-500 bg-gray-50';
    }
  };

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'normal':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading announcements...</div>;
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
          <h1 className="text-3xl font-bold text-gray-900">Announcements</h1>
          <p className="text-gray-600 mt-2">Company-wide announcements and updates</p>
        </div>
        <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
          New Announcement
        </button>
      </div>

      {/* Announcements List */}
      <div className="space-y-4">
        {announcements.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-gray-500">
            No announcements at this time
          </div>
        ) : (
          announcements.map((announcement) => (
            <div
              key={announcement.id}
              className={`rounded-lg p-4 shadow transition-shadow hover:shadow-lg sm:p-6 ${getPriorityColor(announcement.priority)}`}
            >
              <div className="mb-3 flex flex-col items-start justify-between gap-3 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-gray-900">{announcement.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Posted by {announcement.created_by?.email || 'Admin'} on{' '}
                    {new Date(announcement.published_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getPriorityBadgeColor(announcement.priority)}`}>
                  {announcement.priority}
                </span>
              </div>

              <p className="mb-3 whitespace-pre-wrap break-words text-gray-700">{announcement.content}</p>

              {announcement.expires_at && (
                <div className="text-xs text-gray-500">
                  Expires: {new Date(announcement.expires_at).toLocaleDateString()}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 text-sm font-medium">
                  Acknowledge
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
