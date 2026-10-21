/** Header with the TMA owl, the page area, and the bottom tab bar. */
import { useEffect, useRef, type ReactNode } from 'react';
import { href, tabFor, type RouteName, type TabName } from '../lib/router';
import { Icon, type IconName } from './Icon';

const TABS: Array<{ name: TabName; label: string; icon: IconName }> = [
  { name: 'home', label: 'Home', icon: 'home' },
  { name: 'funds', label: 'Funds', icon: 'funds' },
  { name: 'trips', label: 'Trips', icon: 'trips' },
  { name: 'news', label: 'News', icon: 'news' },
  { name: 'more', label: 'More', icon: 'more' },
];

export function Header({ busy }: { busy?: boolean }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <a className="brand" href={href('home')} aria-label="TMA home">
          <img
            className="brand-mark"
            src={`${import.meta.env.BASE_URL}brand/tma-owl-mark.png`}
            alt=""
            width={38}
            height={38}
          />
          <span className="brand-text">
            <span className="brand-name">Timberlane Music Association</span>
            <span className="brand-sub">Family app</span>
          </span>
        </a>
        {busy ? <span className="header-sync" aria-hidden="true" title="Updating" /> : null}
      </div>
    </header>
  );
}

export function TabBar({ route }: { route: RouteName }) {
  const active = tabFor(route);
  return (
    <nav className="tabbar" aria-label="Main">
      <ul className="tabbar-list">
        {TABS.map((t) => (
          <li key={t.name}>
            <a
              className={`tab ${active === t.name ? 'is-active' : ''}`}
              href={href(t.name)}
              aria-current={active === t.name ? 'page' : undefined}
            >
              <Icon name={t.icon} size={22} />
              <span className="tab-label">{t.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({
  route,
  title,
  busy,
  banners,
  children,
}: {
  route: RouteName;
  title: string;
  busy?: boolean;
  banners?: ReactNode;
  children: ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = title ? `${title} · TMA` : 'TMA Family App';
  }, [title]);

  // On navigation, start at the top and move focus to the new page for screen-reader users.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo({ top: 0 });
      } catch {
        // jsdom / old browsers
      }
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [route]);

  return (
    <div className="app">
      <Header busy={busy} />
      {banners}
      <main id="main" className="app-main" ref={mainRef} tabIndex={-1}>
        {children}
      </main>
      <TabBar route={route} />
    </div>
  );
}
