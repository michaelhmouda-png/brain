'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, Zap, RefreshCw, MessageSquare, TrendingUp, TrendingDown } from 'lucide-react';
import Link from 'next/link';

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

interface TimelineEvent {
  id: string;
  event_type: string;
  module: string;
  title: string;
  description?: string;
  severity?: string;
  occurred_at: string;
  task_id?: string;
  employee_id?: string;
  customer_id?: string;
  inventory_item_id?: string;
}

export function PremiumCommandCenter() {
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
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

      // Load timeline events
      await loadTimeline();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load briefing');
    } finally {
      setLoading(false);
    }
  };

  const loadTimeline = async () => {
    try {
      const response = await fetch('/api/brain/timeline');
      if (response.ok) {
        const data = await response.json();
        setTimeline(data.events || []);
      }
    } catch (err) {
      console.error('Failed to load timeline:', err);
    }
  };

  useEffect(() => {
    loadBriefing();
  }, []);

  const getHealthStatus = (score: number): { label: string; color: string } => {
    if (score >= 90) return { label: 'Excellent', color: 'text-green-400' };
    if (score >= 80) return { label: 'Strong', color: 'text-green-300' };
    if (score >= 70) return { label: 'Needs Attention', color: 'text-yellow-400' };
    if (score >= 60) return { label: 'At Risk', color: 'text-orange-400' };
    return { label: 'Critical', color: 'text-red-400' };
  };

  const getHealthSummary = (score: number, categories: any): string => {
    if (score >= 90) return 'Your business is operating strongly. Continue maintaining current practices.';
    if (score >= 80) return 'Your business is running well. Focus on maintaining consistency across all areas.';
    if (score >= 70) return 'Several areas need improvement to optimize operations. Prioritize the recommendations.';
    if (score >= 60) return 'Your business is at risk. Address critical issues immediately to prevent further decline.';
    return 'Your business requires immediate intervention. Multiple critical systems need attention.';
  };

  const getDetailColor = (score: number): string => {
    if (score >= 80) return 'bg-green-900/20 border-green-700 text-green-200';
    if (score >= 70) return 'bg-yellow-900/20 border-yellow-700 text-yellow-200';
    if (score >= 60) return 'bg-orange-900/20 border-orange-700 text-orange-200';
    return 'bg-red-900/20 border-red-700 text-red-200';
  };

  const getCategoryStatus = (score: number): string => {
    if (score >= 80) return 'Excellent';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Fair';
    return 'Poor';
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-900/30 border-red-700 text-red-200';
      case 'high':
        return 'bg-orange-900/30 border-orange-700 text-orange-200';
      case 'medium':
        return 'bg-yellow-900/30 border-yellow-700 text-yellow-200';
      case 'low':
        return 'bg-blue-900/30 border-blue-700 text-blue-200';
      default:
        return 'bg-gray-800/30 border-gray-700 text-gray-200';
    }
  };

  const getSeverityBadge = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-600 text-white',
      medium: 'bg-yellow-600 text-white',
      low: 'bg-blue-600 text-white',
    };
    return colors[severity] || 'bg-gray-600 text-white';
  };

  const openAskBrain = () => {
    const message = briefing
      ? `Analyze today's operational status. Explain why my Brain Score is ${briefing.brain_score.total}, identify the most important issue, and tell me what I should prioritize first.`
      : 'Analyze today\'s operational status and help me understand key priorities.';
    
    sessionStorage.setItem('aiPreloadMessage', message);
    window.location.href = '/dashboard/ai-assistant';
  };

  const getRecommendationLink = (action: string): { href: string; label: string } => {
    const lower = action.toLowerCase();
    if (lower.includes('employee') && lower.includes('incomplete')) {
      return { href: '/dashboard/employees?filter=incomplete', label: 'Review Employees' };
    }
    if (lower.includes('reorder') || lower.includes('low-stock') || lower.includes('inventory')) {
      return { href: '/dashboard/inventory?filter=low-stock', label: 'Open Inventory' };
    }
    if (lower.includes('overdue') && lower.includes('task')) {
      return { href: '/dashboard/tasks?filter=overdue', label: 'View Tasks' };
    }
    if (lower.includes('inactive') && lower.includes('customer')) {
      return { href: '/dashboard/customers?filter=inactive-vip', label: 'View Customers' };
    }
    if (lower.includes('task')) {
      return { href: '/dashboard/tasks', label: 'Open Tasks' };
    }
    if (lower.includes('customer')) {
      return { href: '/dashboard/customers', label: 'Open Customers' };
    }
    return { href: '/dashboard', label: 'Dashboard' };
  };

  const formatTimelineTime = (occurred_at: string): string => {
    const date = new Date(occurred_at);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const getTimelineIcon = (eventType: string) => {
    switch (eventType) {
      case 'task_completed':
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case 'task_created':
      case 'task_assigned':
        return <AlertCircle className="w-4 h-4 text-blue-400" />;
      case 'inventory_movement':
      case 'low_stock_detected':
        return <TrendingDown className="w-4 h-4 text-orange-400" />;
      case 'customer_complaint':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'brain_score_changed':
        return <TrendingUp className="w-4 h-4 text-purple-400" />;
      default:
        return <Zap className="w-4 h-4 text-gray-400" />;
    }
  };

  if (loading && !briefing) {
    return (
      <div className="space-y-6">
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6 space-y-4">
          <div className="h-6 bg-gray-800 rounded w-48 animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-800 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !briefing) {
    return (
      <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-red-300 font-medium">{error}</h3>
            <button
              onClick={loadBriefing}
              className="mt-2 text-sm px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center gap-2"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!briefing) return null;

  const health = getHealthStatus(briefing.brain_score.total);
  const scoreChange = briefing.brain_score.change;

  return (
    <div className="space-y-6">
      {/* Greeting and Refresh */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-words text-3xl font-bold text-white sm:text-4xl">{briefing.greeting}</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-2">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={loadBriefing}
          disabled={loading}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh briefing"
        >
          <RefreshCw className={`w-5 h-5 text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Brain Score Hero */}
      <div className="rounded-lg border border-gray-700 bg-gradient-to-br from-gray-900 to-gray-800 p-4 sm:p-6 lg:p-8">
        <h2 className="text-sm font-semibold text-gray-400 mb-6">BUSINESS BRAIN SCORE</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left: Score */}
          <div>
            <div className={`mb-2 text-5xl font-bold sm:text-7xl ${health.color}`}>
              {briefing.brain_score.total}
            </div>
            <p className="text-gray-400 text-sm mb-4">out of 100</p>
            
            {/* Health Status */}
            <div className="mb-4">
              <h3 className={`text-2xl font-semibold ${health.color}`}>
                {health.label}
              </h3>
            </div>

            {/* Score Change */}
            {scoreChange !== null && (
              <div className="flex items-center gap-2 mb-4">
                {scoreChange > 0 ? (
                  <>
                    <TrendingUp className="w-5 h-5 text-green-400" />
                    <span className="text-green-400 font-semibold">+{scoreChange} since yesterday</span>
                  </>
                ) : scoreChange < 0 ? (
                  <>
                    <TrendingDown className="w-5 h-5 text-red-400" />
                    <span className="text-red-400 font-semibold">{scoreChange} since yesterday</span>
                  </>
                ) : (
                  <span className="text-gray-400">No change since yesterday</span>
                )}
              </div>
            )}

            {/* Health Summary */}
            <p className="text-gray-300 text-sm leading-relaxed">
              {getHealthSummary(briefing.brain_score.total, briefing.brain_score.categories)}
            </p>
          </div>

          {/* Right: Categories */}
          <div className="grid grid-cols-1 gap-3 min-[375px]:grid-cols-2">
            {Object.entries(briefing.brain_score.categories).map(([category, score]) => {
              const categoryHealth = getCategoryStatus(score);
              return (
                <Link
                  key={category}
                  href={
                    category === 'operations' ? '/dashboard/tasks' :
                    category === 'employees' ? '/dashboard/employees' :
                    category === 'inventory' ? '/dashboard/inventory' :
                    category === 'customers' ? '/dashboard/customers' :
                    '/dashboard/settings'
                  }
                  className={`min-h-11 rounded-lg border p-4 transition-all hover:scale-105 cursor-pointer ${getDetailColor(score)}`}
                >
                  <p className="text-xs font-semibold text-gray-400 mb-1 capitalize">{category}</p>
                  <p className="text-2xl font-bold">{score}</p>
                  <p className="text-xs text-gray-400 mt-1">{categoryHealth}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Priorities Section */}
      {briefing.priorities && briefing.priorities.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">TODAY'S PRIORITIES</h2>
          <div className="space-y-3">
            {briefing.priorities.map((priority, idx) => (
              <div
                key={idx}
                className={`p-4 border rounded-lg ${getSeverityColor(priority.severity)}`}
              >
                <div className="flex items-start gap-3">
                  <span className={`px-2.5 py-0.5 rounded text-xs font-semibold ${getSeverityBadge(priority.severity)}`}>
                    {priority.severity.toUpperCase()}
                  </span>
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">{priority.title}</h3>
                    <p className="text-sm opacity-90 mb-2">{priority.description}</p>
                    {priority.type && (
                      <span className="text-xs text-gray-400">{priority.type}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positive Updates */}
      {briefing.positive_updates && briefing.positive_updates.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">POSITIVE UPDATES</h2>
          <div className="space-y-3">
            {briefing.positive_updates.map((update, idx) => (
              <div key={idx} className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-green-200">{update}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommended Actions (Clickable) */}
      {briefing.recommended_actions && briefing.recommended_actions.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-4">RECOMMENDED ACTIONS</h2>
          <div className="space-y-3">
            {briefing.recommended_actions.map((action, idx) => {
              const link = getRecommendationLink(action);
              return (
                <Link
                  key={idx}
                  href={link.href}
                  className="group flex min-h-11 flex-col items-start justify-between gap-2 rounded-lg border border-gray-700 bg-gray-800/50 p-3 transition-all hover:border-blue-600 hover:bg-gray-800 sm:flex-row sm:items-center"
                >
                  <div className="flex items-start gap-3">
                    <Zap className="w-4 h-4 text-blue-400 flex-shrink-0 mt-1" />
                    <p className="text-sm text-blue-200">{action}</p>
                  </div>
                  <span className="text-xs font-semibold text-gray-400 group-hover:text-blue-400 transition">
                    {link.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Today Timeline */}
      {timeline.length > 0 && (
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-300">TODAY'S TIMELINE</h2>
            <button
              onClick={loadTimeline}
              className="text-xs text-gray-400 hover:text-gray-300 transition flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
          
          <div className="space-y-3">
            {timeline.slice(0, 10).map((event) => (
              <div key={event.id} className="flex min-w-0 gap-3 text-sm">
                <div className="flex flex-col items-center gap-1">
                  <div className="text-xs text-gray-500 font-mono">
                    {formatTimelineTime(event.occurred_at)}
                  </div>
                  {getTimelineIcon(event.event_type)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-col items-start justify-between gap-1 min-[375px]:flex-row">
                    <h4 className="break-words font-medium text-gray-200">{event.title}</h4>
                    <span className="shrink-0 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                      {event.module}
                    </span>
                  </div>
                  {event.description && (
                    <p className="mb-1 break-words text-xs text-gray-400">{event.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {timeline.length > 10 && (
            <button className="mt-4 w-full py-2 text-xs font-semibold text-blue-400 hover:text-blue-300 border border-gray-700 hover:border-blue-700 rounded transition">
              View full timeline
            </button>
          )}
        </div>
      )}

      {/* Ask Brain Button */}
      <button
        onClick={openAskBrain}
        className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-all duration-200 flex items-center justify-center gap-2"
      >
        <MessageSquare className="w-4 h-4" />
        Ask Brain About Today
      </button>
    </div>
  );
}
