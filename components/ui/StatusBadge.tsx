import type { LucideIcon } from 'lucide-react';
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
  Clock3,
  Eye,
  Info,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';

export type StatusTone =
  | 'success'
  | 'approved'
  | 'warning'
  | 'pending'
  | 'error'
  | 'rejected'
  | 'info'
  | 'processing'
  | 'offline'
  | 'review'
  | 'failed'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low';

const TONE_CLASS: Record<StatusTone, string> = {
  success: 'ui-status-success',
  approved: 'ui-status-approved',
  warning: 'ui-status-warning',
  pending: 'ui-status-pending',
  error: 'ui-status-error',
  rejected: 'ui-status-rejected',
  info: 'ui-status-info',
  processing: 'ui-status-processing',
  offline: 'ui-status-offline',
  review: 'ui-status-review',
  failed: 'ui-status-failed',
  critical: 'ui-priority-critical',
  high: 'ui-priority-high',
  medium: 'ui-priority-medium',
  low: 'ui-priority-low',
};

const TONE_ICON: Record<StatusTone, LucideIcon> = {
  success: CheckCircle2,
  approved: ShieldCheck,
  warning: TriangleAlert,
  pending: Clock3,
  error: CircleAlert,
  rejected: CircleX,
  info: Info,
  processing: LoaderCircle,
  offline: WifiOff,
  review: Eye,
  failed: CircleAlert,
  critical: CircleAlert,
  high: TriangleAlert,
  medium: CircleDashed,
  low: CheckCircle2,
};

export function StatusBadge({
  label,
  tone,
  className = '',
}: {
  label: string;
  tone: StatusTone;
  className?: string;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      className={`ui-status ${TONE_CLASS[tone]} ${className}`.trim()}
      aria-label={label}
    >
      <Icon aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
