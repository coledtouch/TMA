/** "A new version is ready — Reload" for 'tma:sw-update' events from sw-register.ts. */
import { useEffect, useState } from 'react';

interface SwUpdateDetail {
  update: () => Promise<void>;
}

export function UpdateBanner() {
  const [update, setUpdate] = useState<SwUpdateDetail['update'] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<Partial<SwUpdateDetail> | null>).detail;
      if (detail && typeof detail.update === 'function') {
        const fn = detail.update;
        setUpdate(() => fn);
      }
    };
    window.addEventListener('tma:sw-update', onUpdate);
    return () => window.removeEventListener('tma:sw-update', onUpdate);
  }, []);

  if (!update) return null;
  return (
    <div className="update-banner" role="status">
      <span>A new version of the app is ready.</span>
      <button
        type="button"
        className="btn btn-sm btn-on-brand"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            // Activates the waiting service worker, which reloads the page once it takes control.
            await update();
            setTimeout(() => window.location.reload(), 4000); // fallback if no reload happened
          } catch {
            window.location.reload();
          }
        }}
      >
        {busy ? 'Reloading…' : 'Reload'}
      </button>
    </div>
  );
}
