/**
 * App root: sign-in, then the signed-in shell with hash-routed screens.
 * The API client is created in main.tsx and passed in (tests pass a fake).
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { withAuthGuard, type ApiClient } from './api/client';
import { AppShell } from './components/AppShell';
import { DemoStrip } from './components/DemoStrip';
import { Icon } from './components/Icon';
import { PushBanner } from './components/PushBanner';
import { ErrorState, SkeletonCards } from './components/States';
import { UpdateBanner } from './components/UpdateBanner';
import { AppContext, type AppContextValue } from './hooks/app-context';
import { ToastProvider, useClearToasts, useToast } from './hooks/toast';
import { clearCachedBootstrap, useBootstrap } from './hooks/useBootstrap';
import { useSession, type Session } from './hooks/useSession';
import { formatDateTime } from './lib/format';
import { disablePush, refreshPushRegistration } from './lib/push';
import { navigate, useRoute, type Route } from './lib/router';
import { Admin } from './screens/Admin';
import { Funds } from './screens/Funds';
import { Home } from './screens/Home';
import { Household } from './screens/Household';
import { More } from './screens/More';
import { News } from './screens/News';
import { Notifications } from './screens/Notifications';
import { Reports } from './screens/Reports';
import { SignIn } from './screens/SignIn';
import { Trips } from './screens/Trips';

const SIGN_OUT_PUSH_TIMEOUT_MS = 4000;

const TITLES: Record<Route['name'], string> = {
  home: 'Home',
  funds: 'Activity funds',
  trips: 'Trips',
  news: 'News',
  more: 'More',
  household: 'Household',
  notifications: 'Notifications',
  admin: 'Board tools',
  reports: 'Reports',
};

export function App({ api }: { api: ApiClient }) {
  return (
    <ToastProvider>
      <UpdateBanner />
      <Root api={api} />
    </ToastProvider>
  );
}

function Root({ api }: { api: ApiClient }) {
  const session = useSession(api);
  if (!session.signedIn) {
    return (
      <SignIn api={api} onSignedIn={session.signIn} />
    );
  }
  // Re-mount per account so no state leaks between people sharing a device.
  return <SignedIn key={session.email ?? 'session'} api={api} session={session} />;
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'funds':
      return <Funds key={route.params.student ?? ''} studentId={route.params.student} />;
    case 'trips':
      return <Trips />;
    case 'news':
      return <News />;
    case 'more':
      return <More />;
    case 'household':
      return <Household />;
    case 'notifications':
      return <Notifications />;
    case 'admin':
      return <Admin />;
    case 'reports':
      return <Reports kind={route.params.kind} />;
    default:
      return <Home />;
  }
}

function SignedIn({ api, session }: { api: ApiClient; session: Session }) {
  const toast = useToast();
  const clearToasts = useClearToasts();
  const route = useRoute();
  const endedRef = useRef(false);

  const onUnauthorized = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    clearCachedBootstrap(session.email, api.mode);
    clearToasts();
    session.end();
    toast('Your sign-in expired. Please sign in again.', 'info');
  }, [api.mode, session, toast, clearToasts]);

  const boot = useBootstrap(api, session.email, onUnauthorized);
  const guardedApi = useMemo(() => withAuthGuard(api, onUnauthorized), [api, onUnauthorized]);

  // Keep this device's push subscription current (no-op unless notifications are on here):
  // on start, when the server's push key changes, and when the browser replaces the subscription.
  const pushPublicKey = boot.data ? (boot.data.settings.pushPublicKey ?? '') : null;
  useEffect(() => {
    if (pushPublicKey === null) return;
    const refreshPush = () => void refreshPushRegistration(api, pushPublicKey).catch(() => undefined);
    refreshPush();
    window.addEventListener('tma:pushsubscriptionchange', refreshPush);
    return () => window.removeEventListener('tma:pushsubscriptionchange', refreshPush);
  }, [api, pushPublicKey]);

  const signOut = useCallback(async () => {
    // Stop this device getting the household's notifications, without blocking sign-out on the network.
    // The browser subscription goes even when TMA can't be reached: once signed out, nobody can retry.
    try {
      await Promise.race([
        disablePush(api, { signingOut: true }),
        new Promise((resolve) => setTimeout(resolve, SIGN_OUT_PUSH_TIMEOUT_MS)),
      ]);
    } catch {
      // best effort
    }
    endedRef.current = true;
    clearCachedBootstrap(session.email, api.mode);
    if (boot.data && boot.data.me.email !== session.email) clearCachedBootstrap(boot.data.me.email, api.mode);
    clearToasts(); // they can name this household's students
    session.end();
    navigate('home');
  }, [api, boot.data, session, clearToasts]);

  const { refresh, replace, patch } = boot;
  const context = useMemo<AppContextValue | null>(
    () =>
      boot.data
        ? { api: guardedApi, data: boot.data, refresh, replaceData: replace, patchData: patch, signOut }
        : null,
    [guardedApi, boot.data, refresh, replace, patch, signOut],
  );

  const banners = (
    <>
      <DemoStrip mode={api.mode} />
      <PushBanner onReceive={() => void refresh({ force: true })} />
      {boot.stale && boot.savedAt ? (
        <div className="offline-banner" role="status">
          <Icon name="alert" size={16} />
          <span>Offline: showing info from {formatDateTime(boot.savedAt)}</span>
          <button type="button" className="btn btn-link btn-sm" onClick={() => void refresh({ force: true })}>
            Retry
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <AppShell route={route.name} title={TITLES[route.name]} busy={boot.loading && boot.data !== null} banners={banners}>
      {context ? (
        <AppContext.Provider value={context}>
          <Screen route={route} />
        </AppContext.Provider>
      ) : boot.error ? (
        <ErrorState message={boot.error} onRetry={() => void refresh({ force: true })} />
      ) : (
        <SkeletonCards count={2} label="Loading your TMA info…" />
      )}
    </AppShell>
  );
}
