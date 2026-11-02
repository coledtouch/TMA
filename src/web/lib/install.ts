/**
 * "Install the app" support.
 *
 * Chrome/Edge/Samsung Internet (Android, desktop) fire `beforeinstallprompt`;
 * we keep that event so an Install button can show the browser's dialog
 * later. iPhone/iPad have no such event: families add the app with
 * Share → Add to Home Screen, so we show a hint instead.
 *
 * The event can fire before any React component mounts, so it is captured as
 * soon as this module loads (it is imported by the main bundle).
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { isIos, isStandalone } from './push';

/** Not in TypeScript's DOM lib (Chromium-only API). */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export interface InstallPrompt {
  /** The browser's install dialog is available (Android/desktop Chromium). */
  canPrompt: boolean;
  /** Running as the installed app, or installed during this visit. */
  installed: boolean;
  /** iPhone/iPad in a browser tab: show "Share → Add to Home Screen" steps. */
  showIosHint: boolean;
  /** Inside an app's built-in browser (Facebook, Instagram…), which can't install web apps. */
  inAppBrowser: boolean;
  prompt(): Promise<void>;
}

interface InstallState {
  deferred: BeforeInstallPromptEvent | null;
  installedThisVisit: boolean;
}

let state: InstallState = { deferred: null, installedThisVisit: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<InstallState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): InstallState => state;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's mini-infobar from popping up; we offer a friendlier nudge.
    event.preventDefault();
    setState({ deferred: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    setState({ deferred: null, installedThisVisit: true });
  });
}

/** Facebook/Instagram/Messenger and similar in-app browsers (TMA shares links on Facebook). */
export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|Snapchat|LinkedInApp|Pinterest|TikTok|musical_ly|GSA\//.test(
    navigator.userAgent || '',
  );
}

function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(isStandalone);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(display-mode: standalone)');
    } catch {
      return;
    }
    const onChange = () => setStandalone(isStandalone());
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return standalone;
}

export function useInstallPrompt(): InstallPrompt {
  const { deferred, installedThisVisit } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const standalone = useStandalone();
  const installed = standalone || installedThisVisit;
  const inAppBrowser = isInAppBrowser();

  const prompt = useCallback(async () => {
    const event = state.deferred;
    if (!event) return;
    // The event can only be used once, whatever the parent chooses.
    setState({ deferred: null });
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') setState({ installedThisVisit: true });
    } catch {
      // Dialog already shown or not allowed now; the browser will offer it again later.
    }
  }, []);

  return {
    canPrompt: deferred !== null && !installed,
    installed,
    showIosHint: isIos() && !installed && !inAppBrowser,
    inAppBrowser,
    prompt,
  };
}
