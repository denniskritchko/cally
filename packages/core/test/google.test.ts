import { describe, expect, it } from 'vitest';
import { GoogleCalendarClient, GoogleCalendarSink, toGoogleEvent } from '../src/google/index.js';
import { googleEventId } from '../src/uid.js';
import { normalizePlannerItems } from '../src/canvas/index.js';
import { plannerItems } from './fixtures.js';

const events = normalizePlannerItems(plannerItems, { host: 'canvas.sfu.ca', absoluteUrl: (p) => (p ? `https://canvas.sfu.ca${p}` : undefined) });

describe('toGoogleEvent', () => {
  it('produces valid deterministic ids and timed bodies', () => {
    const a = events.find((e) => e.externalId === 'assignment:555')!;
    const g = toGoogleEvent(a, 'America/Vancouver');
    expect(g.id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(g.id).toBe(googleEventId(a.uid));
    expect(g.start).toEqual({ dateTime: '2026-09-20T06:29:00.000Z', timeZone: 'America/Vancouver' });
    expect(g.transparency).toBe('transparent');
    expect(g.source?.url).toContain('/assignments/555');
  });
});

describe('GoogleCalendarSink', () => {
  it('falls back to PUT on 409 and tolerates 410 on delete', async () => {
    const log: string[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      log.push(`${init?.method} ${url.replace('https://www.googleapis.com/calendar/v3', '')}`);
      if (init?.method === 'POST') return new Response('{"error":"exists"}', { status: 409 });
      if (init?.method === 'DELETE') return new Response('', { status: 410 });
      return new Response('{}', { status: 200 });
    };
    const client = new GoogleCalendarClient(async () => 'tok', fake as any);
    const results: string[] = [];
    const sink = new GoogleCalendarSink(client, { calendarId: 'cal@group.calendar.google.com', timeZone: 'America/Vancouver', onResult: (uid, r) => { results.push(r); } });
    await sink.upsert([events[0]!]);
    await sink.remove([events[1]!.uid]);
    expect(log[0]).toMatch(/^POST \/calendars\/cal%40group\.calendar\.google\.com\/events$/);
    expect(log[1]).toMatch(/^PUT \/calendars\/cal%40group\.calendar\.google\.com\/events\/ca11[0-9a-f]+$/);
    expect(log[2]).toMatch(/^DELETE/);
    expect(results).toEqual(['updated', 'removed']);
  });
});
