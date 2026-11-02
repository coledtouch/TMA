/**
 * Signed-in state. The token lives in the ApiClient (localStorage, per mode);
 * React mirrors it so screens re-render on sign-in/out.
 */
import { useCallback, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client';
import { rememberEmail, sessionEmail } from '../lib/session';

export interface Session {
  signedIn: boolean;
  /** Best-known email for the session (from the token); null when signed out. */
  email: string | null;
  signIn(email: string, token: string): void;
  /** Forget the token locally (no network). */
  end(): void;
}

export function useSession(api: ApiClient): Session {
  const [token, setToken] = useState<string | null>(() => api.getToken());
  const [knownEmail, setKnownEmail] = useState<string | null>(() => sessionEmail(api.getToken(), api.mode));

  const signIn = useCallback(
    (email: string, nextToken: string) => {
      const normalized = email.trim().toLowerCase();
      api.setToken(nextToken);
      rememberEmail(normalized, api.mode);
      setKnownEmail(sessionEmail(nextToken, api.mode) ?? normalized);
      setToken(nextToken);
    },
    [api],
  );

  const end = useCallback(() => {
    api.setToken(null);
    rememberEmail(null, api.mode);
    setToken(null);
    setKnownEmail(null);
  }, [api]);

  return useMemo(
    () => ({ signedIn: token !== null, email: token ? knownEmail : null, signIn, end }),
    [token, knownEmail, signIn, end],
  );
}
