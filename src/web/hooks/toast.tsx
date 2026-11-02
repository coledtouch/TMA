/**
 * Toasts: short confirmations and errors announced to screen readers through
 * an aria-live="polite" region. The region is portaled to <body> so it stays
 * announced while a dialog makes the app root inert.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast>(() => {});
const ClearToastsContext = createContext<() => void>(() => {});

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/** Remove every visible toast (on sign-out, so the next person on a shared phone sees none of them). */
export function useClearToasts(): () => void {
  return useContext(ClearToastsContext);
}

const DURATION_MS: Record<ToastTone, number> = { success: 4500, info: 5000, error: 8000 };
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const show = useCallback<ShowToast>(
    (message, tone = 'success') => {
      const id = nextId.current++;
      setItems((list) => [...list, { id, message, tone }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => remove(id), DURATION_MS[tone]),
      );
    },
    [remove],
  );

  const clear = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setItems([]);
  }, []);

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) clearTimeout(timer);
      map.clear();
    };
  }, []);

  const region = (
    <div className="toasts" aria-live="polite" aria-relevant="additions text">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <span className="toast-text">{t.message}</span>
          <button type="button" className="toast-close" onClick={() => remove(t.id)} aria-label="Dismiss message">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <ToastContext.Provider value={show}>
      <ClearToastsContext.Provider value={clear}>
        {children}
        {typeof document === 'undefined' ? region : createPortal(region, document.body)}
      </ClearToastsContext.Provider>
    </ToastContext.Provider>
  );
}
