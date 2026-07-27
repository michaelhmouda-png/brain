import type { ElementType, ReactNode } from 'react';

export function BrainPage({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <section className={`brain-page ${className}`.trim()}>{children}</section>;
}

export function BrainPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="brain-page-header">
      <div className="min-w-0">
        {eyebrow ? <p className="brain-eyebrow">{eyebrow}</p> : null}
        <h1 className="brain-page-title">{title}</h1>
        {description ? <p className="brain-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="brain-page-actions">{actions}</div> : null}
    </header>
  );
}

export function BrainSurface({
  as: Component = 'section',
  children,
  className = '',
}: {
  as?: ElementType;
  children: ReactNode;
  className?: string;
}) {
  return <Component className={`brain-surface ${className}`.trim()}>{children}</Component>;
}

export function BrainEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="brain-empty-state">
      {icon ? <div className="brain-empty-icon">{icon}</div> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
