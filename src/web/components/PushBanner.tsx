/**
 * In-app notification banner for 'tma:push' window events: the demo's push
 * sender (and foreground messages) dispatch them. Looks like a phone
 * notification; tapping "Open" goes to the message's in-app route.
 */
import { useEffect, useRef, useState } from 'react';
import type { PushMessage } from '../../shared/types';
import { navigate } from '../lib/router';
import { Icon } from './Icon';

export interface PushEventDetail {
  message: PushMessage;
  /** Demo: whose phone the notification was "sent" to. */
  to?: string;
}

const AUTO_HIDE_MS = 9000;

function isPushMessage(value: unknown): value is PushMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.title === 'string' && typeof v.body === 'string';
}

/** Accepts {message, to} or a bare PushMessage. */
export function parsePushDetail(detail: unknown): PushEventDetail | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const d = detail as Record<string, unknown>;
  if (isPushMessage(d.message)) return { message: d.message, to: typeof d.to === 'string' ? d.to : undefined };
  if (isPushMessage(d)) return { message: d };
  return null;
}

export function PushBanner({ onReceive }: { onReceive?: (detail: PushEventDetail) => void }) {
  const [current, setCurrent] = useState<(PushEventDetail & { id: number }) | null>(null);
  const [paused, setPaused] = useState(false);
  const nextId = useRef(1);
  const onReceiveRef = useRef(onReceive);
  useEffect(() => {
    onReceiveRef.current = onReceive;
  }, [onReceive]);

  useEffect(() => {
    const onPush = (event: Event) => {
      const detail = parsePushDetail((event as CustomEvent<unknown>).detail);
      if (!detail) return;
      setCurrent({ ...detail, id: nextId.current++ });
      onReceiveRef.current?.(detail);
    };
    window.addEventListener('tma:push', onPush);
    return () => window.removeEventListener('tma:push', onPush);
  }, []);

  useEffect(() => {
    if (!current || paused) return;
    const timer = setTimeout(() => setCurrent(null), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [current, paused]);

  const url = current?.message.url;
  const hashAt = url ? url.indexOf('#') : -1;
  const route = url && hashAt >= 0 ? (url.slice(hashAt) as `#${string}`) : null;

  return (
    <div className="push-region" role="status" aria-live="polite">
      {current ? (
        <div
          key={current.id}
          className="push-banner"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <img className="push-icon" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={36} height={36} />
          <div className="push-content">
            <p className="push-app">
              TMA <span aria-hidden="true">·</span> now
            </p>
            <p className="push-title">{current.message.title}</p>
            <p className="push-body">{current.message.body}</p>
            {current.to ? (
              <p className="push-to">
                <Icon name="bell" size={14} /> Sent to {current.to}'s phone
              </p>
            ) : null}
            <div className="push-actions">
              {route ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    navigate(route);
                    setCurrent(null);
                  }}
                >
                  Open
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCurrent(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
