'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, Zap, RefreshCw, MessageSquare } from 'lucide-react';

interface DailyBriefing {
  generated_at: string;
  greeting: string;
  brain_score: {
    total: number;
    change: number | null;
    categories: {
      operations: number;
      employees: number;
      inventory: number;
      customers: number;
      data_quality: number;
    };
  };
  priorities: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    description: string;
    related_record_id: string | null;
  }>;
  positive_updates: string[];
  recommended_actions: string[];
  unavailable_metrics: string[];
}

export function DailyBriefingWidget() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadBriefing = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/brain/daily-briefing');
      
      if (response.status === 401) {
        setError('Please sign in to view your briefing.');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load briefing');
      }

      const data = await response.json();
      setBriefing(data);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBriefing();
  }, []);

  const openBrainChat = () => {
    // Store the briefing context in sessionStorage for the chat to use
    if (briefing) {
      sessionStorage.setItem('briefingContext', JSON.stringify(briefing));
    }
    // Navigate to AI Assistant or open chat modal
    window.location.href = '/dashboard/ai-assistant?briefing=true';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-900 border-red-700 text-red-200';
      case 'high':
        return 'bg-orange-900 border-orange-700 text-orange-200';
      case 'medium':
        return 'bg-yellow-900 border-yellow-700 text-yellow-200';
      case 'low':
        return 'bg-blue-900 border-blue-700 text-blue-200';
      default:
        return 'bg-gray-800 border-gray-700 text-gray-200';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'high':
        return <AlertCircle className="w-4 h-4 text-orange-400" />;
      case 'medium':
        return <AlertCircle className="w-4 h-4 text-yellow-400" />;
      default:
        return <AlertCircle className="w-4 h-4 text-blue-400" />;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Loading state
  if (loading && !briefing) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 space-y-4">
        <div className="h-6 bg-gray-800 rounded w-48 animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error && !briefing) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-red-300 font-medium">{error}</h3>
            {error.includes('sign in') && (
              <button
                onClick={() => window.location.href = '/login'}
                className="mt-2 text-sm px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded"
              >
                Sign In
              </button>
            )}
            {!error.includes('sign in') && (
              <button
                onClick={loadBriefing}
                className="mt-2 text-sm px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center gap-2"
              >
                <RefreshCw className="w-3 h-3" />
                Retry
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No data state
  if (!briefing || briefing.unavailable_metrics.length === Object.keys(briefing.brain_score.categories).length) {
    return (
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <p className="text-gray-400">
          Brain needs more operational data to create a complete briefing.
        </p>
        {briefing && briefing.unavailable_metrics.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-gray-500">Missing data:</p>
            <ul className="text-sm text-gray-500 space-y-1">
              {briefing.unavailable_metrics.map((metric, idx) => (
                <li key={idx}>• {metric}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with greeting and refresh */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">{briefing?.greeting}</h1>
        <button
          onClick={loadBriefing}
          disabled={loading}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh briefing"
        >
          <RefreshCw className={`w-5 h-5 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Brain Score */}
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Business Brain Score</h2>
        
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className={`text-5xl font-bold ${getScoreColor(briefing?.brain_score.total || 0)}`}>
              {briefing?.brain_score.total}
            </div>
            <p className="text-sm text-gray-400 mt-1">/ 100</p>
          </div>
          
          {/* Category breakdown mini charts */}
          <div className="grid grid-cols-5 gap-3">
            {Object.entries(briefing?.brain_score.categories || {}).map(([category, score]) => (
              <div key={category} className="text-center">
                <div className="text-2xl font-semibold text-gray-300 mb-1">
                  {score}
                </div>
                <p className="text-xs text-gray-500 capitalize">{category}</p>
              </div>
            ))}
          </div>
        </div>

        {lastUpdated && (
          <p className="text-xs text-gray-500">
            Updated {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* Priorities */}
      {briefing?.priorities && briefing.priorities.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Today's Priorities</h2>
          <div className="space-y-3">
            {briefing.priorities.map((priority, idx) => (
              <div
                key={idx}
                className={`p-3 border rounded-lg ${getSeverityColor(priority.severity)}`}
              >
                <div className="flex items-start gap-3">
                  {getSeverityIcon(priority.severity)}
                  <div className="flex-1">
                    <h3 className="font-medium">{priority.title}</h3>
                    <p className="text-sm mt-1 opacity-90">{priority.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positive Updates */}
      {briefing?.positive_updates && briefing.positive_updates.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Positive Updates</h2>
          <div className="space-y-2">
            {briefing.positive_updates.map((update, idx) => (
              <div key={idx} className="flex items-start gap-3 text-green-200">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{update}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommended Actions */}
      {briefing?.recommended_actions && briefing.recommended_actions.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Recommended Actions</h2>
          <div className="space-y-2">
            {briefing.recommended_actions.map((action, idx) => (
              <div key={idx} className="flex items-start gap-3 text-blue-200">
                <Zap className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{action}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ask Brain Button */}
      <button
        onClick={openBrainChat}
        className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
      >
        <MessageSquare className="w-4 h-4" />
        Ask Brain About Today
      </button>
    </div>
  );
}
