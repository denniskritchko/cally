import ICAL from 'ical.js';
import type { NormalizedEvent, EventKind } from '../types.js';
import { eventUid } from '../uid.js';
import { addDays } from '../time.js';

export interface ParseFeedOptions {
  /** Host of the Canvas instance this feed came from, for UID namespacing. */
  host: string;
}

/**
 * Canvas feed UIDs look like `event-assignment-12345@canvas.sfu.ca` or
 * `event-calendar-event-678@...`. Recover a stable externalId from them so a
 * user who later switches to the API/extension path gets the same UIDs for
 * assignments and calendar events.
 */
export function externalIdFromFeedUid(uid: string): { externalId: string; kind: EventKind } {
  const m = uid.match(/^event-(assignment-override|assignment|calendar-event|quiz|discussion-topic)-(\d+)@/);
  if (!m) return { externalId: `feed:${uid}`, kind: 'other' };
  const [, type, id] = m;
  switch (type) {
    case 'assignment':
    case 'assignment-override':
      return { externalId: `assignment:${id}`, kind: 'assignment' };
    case 'calendar-event':
      return { externalId: `calendar_event:${id}`, kind: 'event' };
    case 'quiz':
      return { externalId: `quiz:${id}`, kind: 'quiz' };
    case 'discussion-topic':
      return { externalId: `discussion_topic:${id}`, kind: 'discussion' };
    default:
      return { externalId: `feed:${uid}`, kind: 'other' };
  }
}

/** Canvas titles the feed "Assignment name [CMPT 225 D100]". Split it. */
export function splitFeedSummary(summary: string): { title: string; courseName?: string } {
  const m = summary.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (!m) return { title: summary.trim() };
  return { title: m[1]!.trim(), courseName: m[2]!.trim() };
}

export function parseCanvasFeed(ics: string, opts: ParseFeedOptions): NormalizedEvent[] {
  const jcal = ICAL.parse(ics);
  const root = new ICAL.Component(jcal);
  const out = new Map<string, NormalizedEvent>();

  for (const vevent of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(vevent);
    if (!ev.uid || !ev.startDate) continue;

    const { externalId, kind } = externalIdFromFeedUid(ev.uid);
    const { title, courseName } = splitFeedSummary(ev.summary ?? 'Untitled');
    const allDay = ev.startDate.isDate;

    let start: string;
    let end: string | undefined;
    if (allDay) {
      start = `${ev.startDate.toString()}T00:00:00.000Z`;
      end = ev.endDate?.isDate ? `${ev.endDate.toString()}T00:00:00.000Z` : addDays(start, 1);
    } else {
      start = ev.startDate.toJSDate().toISOString();
      end = ev.endDate ? ev.endDate.toJSDate().toISOString() : undefined;
    }

    const lastMod = vevent.getFirstPropertyValue('last-modified');
    const url = vevent.getFirstPropertyValue('url');
    const desc = ev.description?.trim();

    const shortCourse = courseName?.match(/^([A-Z]{2,5}\s?\d{3}[A-Z]?)\b/)?.[1];
    out.set(ev.uid, {
      uid: eventUid('canvas', externalId, opts.host),
      source: 'canvas',
      externalId,
      kind,
      title: shortCourse ? `${shortCourse}: ${title}` : title,
      description: [courseName, desc].filter(Boolean).join('\n') || undefined,
      courseName: shortCourse ?? courseName,
      url: typeof url === 'string' ? url : undefined,
      start,
      end,
      allDay,
      updatedAt: lastMod instanceof ICAL.Time ? lastMod.toJSDate().toISOString() : undefined,
    });
  }
  return [...out.values()];
}
