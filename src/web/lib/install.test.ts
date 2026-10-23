// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_FACEBOOK_UA = `${IPHONE_UA} [FBAN/FBIOS;FBAV/470.0.0.0;FBBV/1;FBDV/iPhone15,2]`;
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

const overridden: string[] = [];
function setUserAgent(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  overridden.push('userAgent');
}

/** Fresh module per test: install state is captured at module load. */
async function loadHook() {
  vi.resetModules();
  return (await import('./install')).useInstallPrompt;
}

function installEvent(outcome: 'accepted' | 'dismissed') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn(async () => undefined);
  Object.assign(event, { platforms: ['web'], prompt, userChoice: Promise.resolve({ outcome, platform: 'web' }) });
  return { event, prompt };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of overridden.splice(0)) delete (navigator as unknown as Record<string, unknown>)[key];
});

describe('useInstallPrompt', () => {
  it('captures beforeinstallprompt, suppresses the mini-infobar and offers the prompt', async () => {
    setUserAgent(ANDROID_UA);
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current).toMatchObject({ canPrompt: false, installed: false, showIosHint: false });

    const { event, prompt } = installEvent('accepted');
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.canPrompt).toBe(true);

    await act(async () => {
      await result.current.prompt();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ canPrompt: false, installed: true });
  });

  it('keeps an event that fired before any component mounted', async () => {
    const useInstallPrompt = await loadHook();
    window.dispatchEvent(installEvent('dismissed').event);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canPrompt).toBe(true);
  });

  it('uses the event only once when the parent dismisses the dialog', async () => {
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    const { event, prompt } = installEvent('dismissed');
    act(() => {
      window.dispatchEvent(event);
    });
    await act(async () => {
      await result.current.prompt();
      await result.current.prompt();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ canPrompt: false, installed: false });
  });

  it('marks the app installed on appinstalled', async () => {
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(installEvent('accepted').event);
    });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(result.current).toMatchObject({ canPrompt: false, installed: true });
  });

  it('is installed when running standalone', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query.includes('standalone'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    setUserAgent(IPHONE_UA);
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current).toMatchObject({ installed: true, showIosHint: false });
  });

  it('shows the iOS Add to Home Screen hint in Safari, but not in the Facebook in-app browser', async () => {
    setUserAgent(IPHONE_UA);
    let useInstallPrompt = await loadHook();
    let hook = renderHook(() => useInstallPrompt());
    expect(hook.result.current).toMatchObject({ showIosHint: true, inAppBrowser: false, canPrompt: false });
    hook.unmount();

    setUserAgent(IPHONE_FACEBOOK_UA);
    useInstallPrompt = await loadHook();
    hook = renderHook(() => useInstallPrompt());
    expect(hook.result.current).toMatchObject({ showIosHint: false, inAppBrowser: true });
  });

  it('prompt() without a captured event is a no-op', async () => {
    const useInstallPrompt = await loadHook();
    const { result } = renderHook(() => useInstallPrompt());
    await act(async () => {
      await result.current.prompt();
    });
    expect(result.current.canPrompt).toBe(false);
  });
});
