/** Empty, loading (skeleton) and error states. */
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon = 'music',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={28} />
      </div>
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-text">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <div className="empty-icon empty-icon-danger">
        <Icon name="alert" size={28} />
      </div>
      <p className="empty-title">We couldn't load this</p>
      <p className="empty-text">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <Icon name="refresh" /> Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ width, height = 16, className }: { width?: string | number; height?: number; className?: string }) {
  return <span className={`skeleton ${className ?? ''}`} style={{ width, height }} aria-hidden="true" />;
}

/** Placeholder cards while data loads. */
export function SkeletonCards({ count = 2, label = 'Loading…' }: { count?: number; label?: string }) {
  return (
    <div className="stack" aria-busy="true">
      <span className="visually-hidden" role="status">
        {label}
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div className="card" key={i} aria-hidden="true">
          <Skeleton width="45%" height={20} />
          <Skeleton width="30%" height={14} className="mt-8" />
          <Skeleton width="60%" height={36} className="mt-16" />
          <Skeleton width="80%" height={14} className="mt-8" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  );
}
