/**
 * Browser API client (ARCHITECTURE.md §5, §10).
 *
 * Live mode POSTs `ApiRequest` JSON to the Apps Script web app as text/plain
 * (no CORS preflight, which Apps Script cannot answer). Demo mode runs the
 * same backend core in the browser; it lives in src/demo and is loaded lazily
 * so it never weighs down the live bundle.
 */
import type {
  ApiAction,
  ApiErrorCode,
  ApiParams,
  ApiResult,
  ApiRequest,
} from '../../shared/types';
import type { DemoControls } from '../../demo';
import { getItem, removeItem, setItem, STORAGE_KEYS } from '../lib/storage';

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

export interface ApiClient {
  readonly mode: 'demo' | 'live';
  getToken(): string | null;
  /** Persists to localStorage 'tma.session' (null clears it). */
  setToken(token: string | null): void;
  /** Throws ApiError. */
  call<A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>>;
}

export type DemoApiClient = ApiClient & { demo: DemoControls };

const ERROR_CODES: readonly ApiErrorCode[] = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYMENT_FAILED',
  'NOT_CONFIGURED',
  'INTERNAL',
];

export const NETWORK_ERROR_MESSAGE = 'Network problem — check your connection';
export const TIMEOUT_MESSAGE = 'The TMA server took too long to answer. Please try again.';
export const BAD_RESPONSE_MESSAGE = 'Unexpected answer from the TMA server. Please try again.';
const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';

export const DEFAULT_TIMEOUT_MS = 30_000;

/** Map anything thrown by `call()` to a message a parent can read. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return DEFAULT_ERROR_MESSAGE;
}

export function isApiError(err: unknown, code?: ApiErrorCode): err is ApiError {
  return err instanceof ApiError && (code === undefined || err.code === code);
}

function readStoredToken(): string | null {
  const t = getItem(STORAGE_KEYS.session);
  return t && t.trim() ? t : null;
}

function persistToken(token: string | null): void {
  if (token) setItem(STORAGE_KEYS.session, token);
  else removeItem(STORAGE_KEYS.session);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate an `ApiResponse` body; returns the data or throws ApiError. */
function unwrap(body: unknown): unknown {
  if (!isObject(body) || typeof body.ok !== 'boolean') {
    throw new ApiError('INTERNAL', BAD_RESPONSE_MESSAGE);
  }
  if (body.ok) {
    if (!('data' in body)) throw new ApiError('INTERNAL', BAD_RESPONSE_MESSAGE);
    return body.data;
  }
  const error = isObject(body.error) ? body.error : {};
  const code = ERROR_CODES.includes(error.code as ApiErrorCode) ? (error.code as ApiErrorCode) : 'INTERNAL';
  const message =
    typeof error.message === 'string' && error.message.trim() ? error.message.trim() : DEFAULT_ERROR_MESSAGE;
  throw new ApiError(code, message);
}

export interface LiveClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createLiveClient(apiUrl: string, options: LiveClientOptions = {}): ApiClient {
  const url = apiUrl.trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let token = readStoredToken();

  const client: ApiClient = {
    mode: 'live',
    getToken: () => token,
    setToken(next) {
      token = next && next.trim() ? next : null;
      persistToken(token);
    },
    async call<A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>> {
      const sentToken = token;
      const request: ApiRequest<A> = { action, params, token: sentToken };
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      let text: string;
      try {
        const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(request),
          redirect: 'follow',
          signal: controller.signal,
        });
        text = await res.text();
      } catch {
        throw new ApiError('INTERNAL', timedOut ? TIMEOUT_MESSAGE : NETWORK_ERROR_MESSAGE);
      } finally {
        clearTimeout(timer);
      }

      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new ApiError('INTERNAL', BAD_RESPONSE_MESSAGE);
      }

      try {
        return unwrap(body) as ApiResult<A>;
      } catch (err) {
        // Only forget the token this request used (not one from a newer sign-in).
        if (isApiError(err, 'UNAUTHORIZED') && token === sentToken) client.setToken(null);
        throw err;
      }
    },
  };
  return client;
}

type DemoModule = { createDemoClient(): DemoApiClient };

export type LazyDemoClient = ApiClient & { loadDemo(): Promise<DemoControls> };

/**
 * Demo-mode client that loads src/demo on first use. Token reads/writes before
 * the module loads go straight to localStorage ('tma.session'), which is where
 * the demo client keeps its token too.
 */
export function createLazyDemoClient(
  load: () => Promise<DemoModule> = () => import('../../demo'),
): LazyDemoClient {
  let real: DemoApiClient | null = null;
  let loading: Promise<DemoApiClient> | null = null;

  const get = (): Promise<DemoApiClient> => {
    loading ??= load().then(
      (mod) => (real = mod.createDemoClient()),
      () => {
        loading = null;
        throw new ApiError('INTERNAL', "Couldn't load the demo. Check your connection and reload the page.");
      },
    );
    return loading;
  };

  return {
    mode: 'demo',
    getToken: () => (real ? real.getToken() : readStoredToken()),
    setToken(token) {
      if (real) real.setToken(token);
      else persistToken(token && token.trim() ? token : null);
    },
    async call<A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>> {
      // The demo client clears its own token on UNAUTHORIZED.
      return (await get()).call(action, params);
    },
    async loadDemo() {
      return (await get()).demo;
    },
  };
}

/** VITE_API_URL set → live Apps Script backend; empty → in-browser demo. */
export function createApiClient(): ApiClient {
  const url = (import.meta.env.VITE_API_URL ?? '').trim();
  return url ? createLiveClient(url) : createLazyDemoClient();
}

/**
 * Same client, but `onUnauthorized` runs whenever a call fails with
 * UNAUTHORIZED (expired session, signed out elsewhere). Other members (mode,
 * demo controls, …) pass through untouched.
 */
export function withAuthGuard<T extends ApiClient>(api: T, onUnauthorized: () => void): T {
  const call = async <A extends ApiAction>(action: A, params: ApiParams<A>): Promise<ApiResult<A>> => {
    try {
      return await api.call(action, params);
    } catch (err) {
      if (isApiError(err, 'UNAUTHORIZED')) onUnauthorized();
      throw err;
    }
  };
  return new Proxy(api, {
    get(target, prop, receiver) {
      return prop === 'call' ? call : Reflect.get(target, prop, receiver);
    },
  });
}

/** Demo controls for a demo-mode client (eager or lazy); null in live mode. */
export async function getDemoControls(api: ApiClient): Promise<DemoControls | null> {
  if (api.mode !== 'demo') return null;
  const candidate = api as Partial<DemoApiClient & LazyDemoClient>;
  if (candidate.demo) return candidate.demo;
  if (typeof candidate.loadDemo === 'function') return candidate.loadDemo();
  return null;
}
