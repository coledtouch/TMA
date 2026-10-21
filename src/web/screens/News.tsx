/** News: upcoming events and announcements matching the family's notification interests. */
import type { Announcement, Audience, EventItem } from '../../shared/types';
import { DateBadge } from '../components/DateBadge';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/States';
import { Chip } from '../components/StatusChip';
import { useApp } from '../hooks/app-context';
import { audienceLabels, formatDate, formatWeekdayDate, safeHref } from '../lib/format';
import { href } from '../lib/router';

function AudienceChips({ audience }: { audience: Audience }) {
  const labels = audienceLabels(audience);
  return (
    <div className="chips">
      <span className="visually-hidden">For: </span>
      {labels.length === 0 ? <Chip>Everyone</Chip> : labels.map((l) => <Chip key={l} tone="brand">{l}</Chip>)}
    </div>
  );
}

export function News() {
  const { data } = useApp();
  const { events, announcements, prefs } = data;
  const filtered = prefs.schools.length + prefs.ensembles.length > 0;

  return (
    <div className="screen">
      <div className="screen-head">
        <h1 className="screen-title">News & events</h1>
        <p className="screen-sub">
          {filtered ? 'Showing news for the schools and groups you follow. ' : 'Showing news for all TMA groups. '}
          <a href={href('notifications')}>Change</a>
        </p>
      </div>

      <section className="section" aria-labelledby="events-title">
        <h2 id="events-title" className="section-title">
          Upcoming events
        </h2>
        {events.length === 0 ? (
          <div className="card">
            <EmptyState icon="calendar" title="No upcoming events">
              Concerts, meetings and deadlines will show up here.
            </EmptyState>
          </div>
        ) : (
          <ul className="stack" aria-label="Upcoming events">
            {events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </ul>
        )}
      </section>

      <section className="section" aria-labelledby="ann-title">
        <h2 id="ann-title" className="section-title">
          Announcements
        </h2>
        {announcements.length === 0 ? (
          <div className="card">
            <EmptyState icon="news" title="No news yet">
              Announcements from TMA will show up here.
            </EmptyState>
          </div>
        ) : (
          <ul className="stack" aria-label="Announcements">
            {announcements.map((a) => (
              <AnnouncementCard key={a.id} announcement={a} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EventCard({ event }: { event: EventItem }) {
  const when = [formatWeekdayDate(event.date), event.time].filter(Boolean).join(' · ');
  return (
    <li className="card event-card">
      <DateBadge date={event.date} />
      <div className="event-main">
        <h3 className="card-title">{event.title}</h3>
        <p className="muted small">
          {when}
          {event.location ? (
            <>
              <br />
              {event.location}
            </>
          ) : null}
        </p>
        {event.details ? <p className="preline small">{event.details}</p> : null}
        <AudienceChips audience={event.audience} />
      </div>
    </li>
  );
}

export function AnnouncementCard({ announcement: a }: { announcement: Announcement }) {
  const link = safeHref(a.link);
  return (
    <li className="card announcement">
      <p className="muted small">{formatDate(a.date)}</p>
      <h3 className="card-title">{a.title}</h3>
      <p className="preline">{a.body}</p>
      {link ? (
        <a className="link-more" href={link} target="_blank" rel="noopener noreferrer">
          Learn more <Icon name="external" size={14} />
        </a>
      ) : null}
      <AudienceChips audience={a.audience} />
    </li>
  );
}
