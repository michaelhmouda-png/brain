'use client';

import { useEffect, useState } from 'react';

interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: string;
  published_at: string;
  expires_at?: string;
  created_by?: { email: string };
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAnnouncements() {
      try {
        const res = await fetch('/api/announcements');
        const data = await res.json();
        setAnnouncements(data);
      } catch (error) {
        console.error('Error loading announcements:', error);
      } finally {
        setLoading(false);
      }
    }

    loadAnnouncements();
  }, []);

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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
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
              className={`rounded-lg shadow p-6 hover:shadow-lg transition-shadow ${getPriorityColor(announcement.priority)}`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex-1">
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

              <p className="text-gray-700 mb-3">{announcement.content}</p>

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
