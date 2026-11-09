/** Render a signed-in screen with a fake ApiClient and Bootstrap. */
import { render, type RenderResult } from '@testing-library/react';
import { useState, type ReactElement } from 'react';
import { vi } from 'vitest';
import type { Bootstrap } from '../../shared/types';
import type { ApiClient } from '../api/client';
import { AppContext, type AppContextValue } from '../hooks/app-context';
import { ToastProvider } from '../hooks/toast';
import { makeBootstrap } from './fixtures';

export interface ScreenHarness extends RenderResult {
  refresh: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  /** The latest data the screen has (after replaceData/patchData). */
  data(): Bootstrap;
}

export function renderScreen(ui: ReactElement, { api, data = makeBootstrap() }: { api: ApiClient; data?: Bootstrap }): ScreenHarness {
  const refresh = vi.fn(async () => {});
  const signOut = vi.fn(async () => {});
  let latest = data;

  function Harness() {
    const [current, setCurrent] = useState(data);
    latest = current;
    const value: AppContextValue = {
      api,
      data: current,
      refresh,
      replaceData: setCurrent,
      patchData: (fn) => setCurrent((b) => fn(b)),
      signOut,
    };
    return (
      <ToastProvider>
        <AppContext.Provider value={value}>{ui}</AppContext.Provider>
      </ToastProvider>
    );
  }

  const result = render(<Harness />);
  return { ...result, refresh, signOut, data: () => latest };
}
