import { useState, type ReactNode } from 'react';
import { useApp } from '../hooks/app-context';
import { dismiss, isDismissed } from '../lib/storage';
import { Icon, type IconName } from './Icon';

/**
 * A dismissible suggestion card ("Turn on notifications"). "Not now" is
 * remembered on this device (separately for the demo and the live app).
 */
export function Nudge({
  id,
  icon,
  title,
  children,
  action,
}: {
  id: string;
  icon: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const mode = useApp().api.mode;
  const [hidden, setHidden] = useState(() => isDismissed(id, mode));
  if (hidden) return null;
  return (
    <section className="nudge" aria-label={title}>
      <div className="nudge-icon">
        <Icon name={icon} />
      </div>
      <div className="nudge-body">
        <p className="nudge-title">{title}</p>
        {children ? <div className="nudge-text">{children}</div> : null}
        <div className="nudge-actions">
          {action}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              dismiss(id, mode);
              setHidden(true);
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </section>
  );
}
