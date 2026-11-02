// @vitest-environment jsdom
import {
  canExitDemo,
  currentAppMode,
  enterDemo,
  exitDemo,
  initAppMode,
  migrateLegacyStorage,
  MODE_KEY,
  STORAGE_LAYOUT_KEY,
} from './mode';
import { DEMO_DB_KEY, storageKeys } from './storage';

const API_URL = 'https://script.google.com/macros/s/abc/exec';
const LIVE = storageKeys('live');
const DEMO = storageKeys('demo');

function goTo(path: string): void {
  window.history.replaceState(null, '', path);
}

function liveBuild(): void {
  vi.stubEnv('VITE_API_URL', API_URL);
}

function demoBuild(): void {
  vi.stubEnv('VITE_API_URL', '');
}

/** localStorage that refuses writes (Safari with site data blocked, quota). */
function storageRefusesWrites(): void {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
}

beforeEach(() => {
  localStorage.clear();
  goTo('/tma/');
});

afterEach(() => {
  vi.unstubAllEnvs();
  goTo('/');
});

describe('currentAppMode', () => {
  it('is always the demo without VITE_API_URL', () => {
    demoBuild();
    expect(currentAppMode()).toBe('demo');
    goTo('/tma/?demo=0');
    expect(currentAppMode()).toBe('demo');
    expect(canExitDemo()).toBe(false);
  });

  it('is live on a live build unless this browser chose the demo', () => {
    liveBuild();
    expect(currentAppMode()).toBe('live');
    expect(canExitDemo()).toBe(false);
    localStorage.setItem(MODE_KEY, 'demo');
    expect(currentAppMode()).toBe('demo');
    expect(canExitDemo()).toBe(true);
    localStorage.setItem(MODE_KEY, 'something else');
    expect(currentAppMode()).toBe('live');
  });

  it('follows a ?demo switch still in the address', () => {
    liveBuild();
    goTo('/tma/?demo');
    expect(currentAppMode()).toBe('demo');
    localStorage.setItem(MODE_KEY, 'demo');
    goTo('/tma/?demo=0');
    expect(currentAppMode()).toBe('live');
  });
});

describe('initAppMode', () => {
  it('remembers "?demo" on a live build and removes it from the address, keeping the route', () => {
    liveBuild();
    goTo('/tma/?demo&x=1#/funds');
    expect(initAppMode()).toBe('demo');
    expect(localStorage.getItem(MODE_KEY)).toBe('demo');
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('#/funds');
    // A reload (no switch in the address any more) stays in the demo.
    expect(initAppMode()).toBe('demo');
  });

  it('switches back to live with "?demo=0"', () => {
    liveBuild();
    localStorage.setItem(MODE_KEY, 'demo');
    goTo('/tma/?demo=0');
    expect(initAppMode()).toBe('live');
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('leaves the address alone and remembers nothing on a demo-only build', () => {
    demoBuild();
    goTo('/tma/?demo');
    expect(initAppMode()).toBe('demo');
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(window.location.search).toBe('?demo');
  });

  it('keeps "?demo" in the address when it cannot be remembered', () => {
    liveBuild();
    storageRefusesWrites();
    goTo('/tma/?demo');
    expect(initAppMode()).toBe('demo');
    expect(window.location.search).toBe('?demo');
  });
});

describe('enterDemo / exitDemo', () => {
  it('enterDemo remembers the demo and reloads to the start of the app', () => {
    liveBuild();
    goTo('/tma/#/notifications');
    const reload = vi.fn();
    enterDemo(reload);
    expect(localStorage.getItem(MODE_KEY)).toBe('demo');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/tma/');
    expect(window.location.hash).toBe('');
    expect(currentAppMode()).toBe('demo');
  });

  it('enterDemo puts the switch in the address when storage refuses it', () => {
    liveBuild();
    storageRefusesWrites();
    const reload = vi.fn();
    enterDemo(reload);
    expect(window.location.search).toBe('?demo=1');
    expect(reload).toHaveBeenCalled();
    expect(currentAppMode()).toBe('demo');
  });

  it('enterDemo does nothing on a demo-only build', () => {
    demoBuild();
    const reload = vi.fn();
    enterDemo(reload);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it('exitDemo forgets the demo and reloads into the live app', () => {
    liveBuild();
    localStorage.setItem(MODE_KEY, 'demo');
    goTo('/tma/?demo#/admin');
    const reload = vi.fn();
    exitDemo(reload);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(currentAppMode()).toBe('live');
  });

  it("switching modes leaves each mode's sign-in, cache and push registration alone", () => {
    liveBuild();
    localStorage.setItem(LIVE.session, 'live-token');
    localStorage.setItem(`${LIVE.cachePrefix}parent@example.com`, '{"live":true}');
    localStorage.setItem(LIVE.push, '{"token":"live"}');
    localStorage.setItem(DEMO.session, 'demo-token');
    enterDemo(vi.fn());
    exitDemo(vi.fn());
    expect(localStorage.getItem(LIVE.session)).toBe('live-token');
    expect(localStorage.getItem(`${LIVE.cachePrefix}parent@example.com`)).toBe('{"live":true}');
    expect(localStorage.getItem(LIVE.push)).toBe('{"token":"live"}');
    expect(localStorage.getItem(DEMO.session)).toBe('demo-token');
  });
});

describe('storage keys', () => {
  it('never share a key between the demo and the live app', () => {
    const live = Object.values(LIVE);
    const demo = Object.values(DEMO);
    for (const key of demo) {
      expect(live).not.toContain(key);
      for (const prefix of [LIVE.cachePrefix, LIVE.dismissedPrefix]) expect(key.startsWith(prefix)).toBe(false);
    }
    expect(LIVE.session).toBe('tma.session');
    expect(DEMO.session).toBe('tma.demo.session');
    expect(LIVE.cachePrefix).toBe('tma.cache.');
    expect(DEMO.cachePrefix).toBe('tma.demo.cache.');
  });
});

describe('migrateLegacyStorage', () => {
  function legacyState(): void {
    localStorage.setItem('tma.session', 'old-token');
    localStorage.setItem('tma.email', 'parent@example.com');
    localStorage.setItem('tma.cache.parent@example.com', '{"cached":true}');
    localStorage.setItem('tma.dismissed.push', '2026-10-01T00:00:00.000Z');
  }

  it('moves what an earlier demo build stored to the demo keys', () => {
    legacyState();
    localStorage.setItem('tma.pushToken', 'demo-123');
    localStorage.setItem('tma.pushToken.at', '2026-10-01T00:00:00.000Z');
    localStorage.setItem(DEMO_DB_KEY, '{}');

    migrateLegacyStorage();

    expect(localStorage.getItem(DEMO.session)).toBe('old-token');
    expect(localStorage.getItem(DEMO.email)).toBe('parent@example.com');
    expect(localStorage.getItem(`${DEMO.cachePrefix}parent@example.com`)).toBe('{"cached":true}');
    expect(localStorage.getItem(`${DEMO.dismissedPrefix}push`)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(DEMO.push)!)).toEqual({ token: 'demo-123', at: '2026-10-01T00:00:00.000Z' });
    for (const key of ['tma.session', 'tma.email', 'tma.cache.parent@example.com', 'tma.dismissed.push', 'tma.pushToken']) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem(DEMO_DB_KEY)).toBe('{}');
  });

  it('leaves what an earlier live build stored as the live state, dropping only the old push token', () => {
    legacyState();
    localStorage.setItem('tma.pushToken', 'fcm-token-1234567890');

    migrateLegacyStorage();

    expect(localStorage.getItem(LIVE.session)).toBe('old-token');
    expect(localStorage.getItem(`${LIVE.cachePrefix}parent@example.com`)).toBe('{"cached":true}');
    expect(localStorage.getItem('tma.pushToken')).toBeNull();
    expect(localStorage.getItem(DEMO.session)).toBeNull();
  });

  it('runs once, so later live sessions are never moved', () => {
    localStorage.setItem(DEMO_DB_KEY, '{}');
    migrateLegacyStorage();
    expect(localStorage.getItem(STORAGE_LAYOUT_KEY)).toBe('2');
    localStorage.setItem(LIVE.session, 'live-token');
    migrateLegacyStorage();
    initAppMode();
    expect(localStorage.getItem(LIVE.session)).toBe('live-token');
  });

  it('does not overwrite demo state that already exists', () => {
    localStorage.setItem(DEMO_DB_KEY, '{}');
    localStorage.setItem('tma.session', 'old-token');
    localStorage.setItem(DEMO.session, 'newer-demo-token');
    migrateLegacyStorage();
    expect(localStorage.getItem(DEMO.session)).toBe('newer-demo-token');
    expect(localStorage.getItem('tma.session')).toBeNull();
  });
});
