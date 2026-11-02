// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { href, navigate, parseHash, tabFor, useRoute } from './router';

describe('parseHash', () => {
  it('maps known paths to routes', () => {
    expect(parseHash('#/')).toEqual({ name: 'home', params: {} });
    expect(parseHash('')).toEqual({ name: 'home', params: {} });
    expect(parseHash('#/funds')).toEqual({ name: 'funds', params: {} });
    expect(parseHash('#/trips/')).toEqual({ name: 'trips', params: {} });
    expect(parseHash('#/News')).toEqual({ name: 'news', params: {} });
    expect(parseHash('#/admin')).toEqual({ name: 'admin', params: {} });
    expect(parseHash('#notifications')).toEqual({ name: 'notifications', params: {} });
  });

  it('reads query params', () => {
    expect(parseHash('#/funds?student=S0001')).toEqual({ name: 'funds', params: { student: 'S0001' } });
  });

  it('sends unknown routes home without params', () => {
    expect(parseHash('#/nope?x=1')).toEqual({ name: 'home', params: {} });
    expect(parseHash('#javascript:alert(1)')).toEqual({ name: 'home', params: {} });
  });
});

describe('href', () => {
  it('builds hash links', () => {
    expect(href('home')).toBe('#/');
    expect(href('funds', { student: 'S0001' })).toBe('#/funds?student=S0001');
    expect(href('trips', { student: undefined })).toBe('#/trips');
  });

  it('round-trips through parseHash', () => {
    expect(parseHash(href('household'))).toEqual({ name: 'household', params: {} });
  });
});

describe('tabFor', () => {
  it('highlights More for secondary screens', () => {
    expect(tabFor('home')).toBe('home');
    expect(tabFor('funds')).toBe('funds');
    expect(tabFor('household')).toBe('more');
    expect(tabFor('notifications')).toBe('more');
    expect(tabFor('admin')).toBe('more');
  });
});

describe('navigate + useRoute', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('updates the route when the hash changes', async () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current.name).toBe('home');

    await act(async () => {
      navigate('trips');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(window.location.hash).toBe('#/trips');
    expect(result.current.name).toBe('trips');

    await act(async () => {
      navigate('#/funds?student=S0002');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(result.current).toEqual({ name: 'funds', params: { student: 'S0002' } });
  });
});
