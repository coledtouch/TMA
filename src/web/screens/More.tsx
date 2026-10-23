/** More: account, household, notifications, install, privacy, help, demo controls, sign out. */
import { useState } from 'react';
import { DemoControls } from '../components/DemoControls';
import { Icon, type IconName } from '../components/Icon';
import { StatusChip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { IN_APP_BROWSER_HINT } from '../lib/copy';
import { safeHref } from '../lib/format';
import { useInstallPrompt } from '../lib/install';
import { href, type RouteName } from '../lib/router';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

function LinkRow({ to, icon, title, sub }: { to: RouteName; icon: IconName; title: string; sub?: string }) {
  return (
    <li>
      <a className="list-row" href={href(to)}>
        <span className="list-icon">
          <Icon name={icon} />
        </span>
        <span className="list-main">
          <span className="list-title">{title}</span>
          {sub ? <span className="muted small">{sub}</span> : null}
        </span>
        <Icon name="chevron" />
      </a>
    </li>
  );
}

export function More() {
  const { api, data, signOut } = useApp();
  const { me, settings } = data;
  const [signingOut, setSigningOut] = useState(false);
  const donate = safeHref(settings.donateUrl);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">More</h1>
      </div>

      <section className="card profile" aria-label="Your account">
        <span className="avatar avatar-lg" aria-hidden="true">
          {(me.name.trim()[0] ?? '?').toUpperCase()}
        </span>
        <div className="profile-main">
          <p className="profile-name">{me.name}</p>
          <p className="muted small break">{me.email}</p>
          {me.familyStatus === 'Active' ? <StatusChip status="Verified" /> : null}
          {me.familyStatus === 'Pending' ? <StatusChip status="Awaiting verification" /> : null}
        </div>
      </section>

      <nav aria-label="Settings">
        <ul className="card list">
          <LinkRow
            to="household"
            icon="users"
            title={me.familyStatus === 'None' ? 'Set up your household' : 'Your household'}
            sub="Parents and students"
          />
          <LinkRow to="notifications" icon="bell" title="Notifications" sub="What you hear about, and how" />
          {me.isAdmin ? <LinkRow to="admin" icon="admin" title="Board tools" sub="Requests, sign-ups, announcements" /> : null}
        </ul>
      </nav>

      <InstallCard />

      {api.mode === 'demo' ? <DemoControls /> : null}

      <section className="card" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="card-title card-title-sm">
          <Icon name="lock" size={18} /> Your privacy
        </h2>
        <p className="small preline">{settings.privacyNote}</p>
      </section>

      <section className="card" aria-labelledby="help-title">
        <h2 id="help-title" className="card-title card-title-sm">
          <Icon name="info" size={18} /> Help & contact
        </h2>
        <p className="small">
          Questions about funds, trips or payments? Email{' '}
          <a href={`mailto:${settings.supportEmail}`} className="break">
            {settings.supportEmail}
          </a>
          .
        </p>
        {donate ? (
          <a className="btn btn-secondary btn-block" href={donate} target="_blank" rel="noopener noreferrer">
            <Icon name="heart" /> Donate to {settings.orgName}
          </a>
        ) : null}
      </section>

      <button
        type="button"
        className="btn btn-secondary btn-block"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true);
          await signOut();
        }}
      >
        <Icon name="logout" /> {signingOut ? 'Signing out…' : 'Sign out'}
      </button>

      <p className="app-version">
        TMA Family App v{APP_VERSION}
        {api.mode === 'demo' ? ' · Demo' : ''}
      </p>
    </div>
  );
}

function InstallCard() {
  const install = useInstallPrompt();
  if (install.inAppBrowser) {
    return (
      <p className="callout callout-info small">
        <Icon name="external" size={16} />
        <span>{IN_APP_BROWSER_HINT}</span>
      </p>
    );
  }
  if (install.installed) {
    return (
      <p className="callout callout-success small">
        <Icon name="check" size={16} /> The TMA app is installed on this device.
      </p>
    );
  }
  if (install.canPrompt) {
    return (
      <section className="card" aria-labelledby="install-title">
        <h2 id="install-title" className="card-title card-title-sm">
          <Icon name="download" size={18} /> Install the app
        </h2>
        <p className="small">Add TMA to your home screen so it opens like any other app.</p>
        <button type="button" className="btn btn-primary btn-block" onClick={() => void install.prompt()}>
          Install TMA
        </button>
      </section>
    );
  }
  if (install.showIosHint) {
    return (
      <section className="card" aria-labelledby="install-title">
        <h2 id="install-title" className="card-title card-title-sm">
          <Icon name="download" size={18} /> Add TMA to your Home Screen
        </h2>
        <ol className="steps">
          <li>
            Tap the <strong>Share</strong> button <Icon name="share" size={16} /> in Safari.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong> <Icon name="addSquare" size={16} />.
          </li>
          <li>Open TMA from your Home Screen.</li>
        </ol>
      </section>
    );
  }
  return null;
}
