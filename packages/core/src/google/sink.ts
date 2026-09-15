import type { CalendarSink, NormalizedEvent } from '../types.js';
import { googleEventId } from '../uid.js';

const API = 'https://www.googleapis.com/calendar/v3';

export type AccessTokenProvider = () => Promise<string>;

export class GoogleHttpError extends Error {
  constructor(public status: number, public url: string, body: string) {
    super(`Google ${status} for ${url}: ${body.slice(0, 300)}`);
  }
}

export interface GoogleEventBody {
  id: string;
  summary: string;
  description?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
  source?: { title: string; url: string };
  status: 'confirmed';
  transparency: 'transparent';
  extendedProperties: { private: { callyUid: string; callyKind: string } };
  reminders?: { useDefault: boolean };
}

export function toGoogleEvent(ev: NormalizedEvent, timeZone: string): GoogleEventBody {
  const start = ev.allDay
    ? { date: ev.start.slice(0, 10) }
    : { dateTime: ev.start, timeZone };
  const endIso = ev.end && ev.end > ev.start ? ev.end : ev.start;
  const end = ev.allDay
    ? { date: (ev.end ?? ev.start).slice(0, 10) }
    : { dateTime: endIso, timeZone };
  const body: GoogleEventBody = {
    id: googleEventId(ev.uid),
    summary: ev.completed ? `✓ ${ev.title}` : ev.title,
    description: [ev.description, ev.url].filter(Boolean).join('\n\n') || undefined,
    start,
    end,
    status: 'confirmed',
    transparency: 'transparent', // due dates shouldn't block free/busy
    extendedProperties: { private: { callyUid: ev.uid, callyKind: ev.kind } },
    reminders: { useDefault: true },
  };
  if (ev.url) body.source = { title: 'Open in Canvas', url: ev.url };
  return body;
}

export class GoogleCalendarClient {
  constructor(private readonly token: AccessTokenProvider, private readonly fetchImpl: typeof fetch = fetch) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new GoogleHttpError(res.status, url, text);
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async createCalendar(summary: string, timeZone: string): Promise<string> {
    const { data } = await this.request<{ id: string }>('POST', '/calendars', { summary, timeZone });
    return data.id;
  }

  /** Returns false if the calendar no longer exists (user deleted it). */
  async calendarExists(calendarId: string): Promise<boolean> {
    try {
      await this.request('GET', `/calendars/${encodeURIComponent(calendarId)}`);
      return true;
    } catch (e) {
      if (e instanceof GoogleHttpError && (e.status === 404 || e.status === 410)) return false;
      throw e;
    }
  }

  async upsertEvent(calendarId: string, body: GoogleEventBody): Promise<'created' | 'updated'> {
    const cal = encodeURIComponent(calendarId);
    try {
      await this.request('POST', `/calendars/${cal}/events`, body);
      return 'created';
    } catch (e) {
      // 409 = id already exists (possibly as a cancelled/deleted event). PUT resurrects + updates.
      if (!(e instanceof GoogleHttpError) || e.status !== 409) throw e;
      await this.request('PUT', `/calendars/${cal}/events/${body.id}`, body);
      return 'updated';
    }
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.request('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`);
    } catch (e) {
      if (e instanceof GoogleHttpError && (e.status === 404 || e.status === 410)) return; // already gone
      throw e;
    }
  }
}

export interface GoogleSinkOptions {
  calendarId: string;
  timeZone: string;
  /** Called per event with the outcome; lets the caller persist mappings incrementally. */
  onResult?: (uid: string, result: 'created' | 'updated' | 'removed' | 'error', err?: unknown) => void | Promise<void>;
}

/** Writes normalized events into a single app-owned Google calendar. */
export class GoogleCalendarSink implements CalendarSink {
  constructor(private readonly client: GoogleCalendarClient, private readonly opts: GoogleSinkOptions) {}

  async upsert(events: NormalizedEvent[]): Promise<void> {
    for (const ev of events) {
      try {
        const r = await this.client.upsertEvent(this.opts.calendarId, toGoogleEvent(ev, this.opts.timeZone));
        await this.opts.onResult?.(ev.uid, r);
      } catch (err) {
        await this.opts.onResult?.(ev.uid, 'error', err);
        if (err instanceof GoogleHttpError && (err.status === 401 || err.status === 403 || err.status === 429)) throw err;
      }
    }
  }

  async remove(uids: string[]): Promise<void> {
    for (const uid of uids) {
      try {
        await this.client.deleteEvent(this.opts.calendarId, googleEventId(uid));
        await this.opts.onResult?.(uid, 'removed');
      } catch (err) {
        await this.opts.onResult?.(uid, 'error', err);
        if (err instanceof GoogleHttpError && (err.status === 401 || err.status === 403 || err.status === 429)) throw err;
      }
    }
  }
}
