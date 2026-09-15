import { describe, expect, it } from 'vitest';
import ICAL from 'ical.js';
import { parseCanvasFeed, generateIcs, foldLine, escapeText } from '../src/ics/index.js';
import { normalizePlannerItems } from '../src/canvas/index.js';
import { canvasFeed, plannerItems } from './fixtures.js';

describe('parseCanvasFeed', () => {
  const events = parseCanvasFeed(canvasFeed, { host: 'canvas.sfu.ca' });

  it('recovers the same externalIds the API path would produce', () => {
    expect(events.map((e) => e.externalId).sort()).toEqual(['assignment:555', 'calendar_event:42']);
    const api = normalizePlannerItems(plannerItems, { host: 'canvas.sfu.ca', absoluteUrl: () => undefined });
    const apiUid = api.find((e) => e.externalId === 'assignment:555')!.uid;
    expect(events.find((e) => e.externalId === 'assignment:555')!.uid).toBe(apiUid);
  });

  it('handles all-day and timed events', () => {
    const a = events.find((e) => e.externalId === 'assignment:555')!;
    expect(a.allDay).toBe(true);
    expect(a.start).toBe('2026-09-19T00:00:00.000Z');
    expect(a.end).toBe('2026-09-20T00:00:00.000Z');
    expect(a.title).toBe('CMPT 225: Assignment 2: Linked Lists');
    expect(a.url).toContain('/assignments/555');

    const m = events.find((e) => e.externalId === 'calendar_event:42')!;
    expect(m.allDay).toBe(false);
    expect(m.start).toBe('2026-10-01T17:30:00.000Z');
    expect(m.updatedAt).toBe('2026-09-02T08:00:00.000Z');
  });
});

describe('generateIcs', () => {
  const events = normalizePlannerItems(plannerItems, { host: 'canvas.sfu.ca', absoluteUrl: (p) => (p ? `https://canvas.sfu.ca${p}` : undefined) });
  const ics = generateIcs(events, { calendarName: 'Canvas (SFU)', timezone: 'America/Vancouver' }, '2026-09-15T00:00:00Z');

  it('round-trips through a strict parser', () => {
    const root = new ICAL.Component(ICAL.parse(ics));
    const vevents = root.getAllSubcomponents('vevent');
    expect(vevents).toHaveLength(events.length);
    const byUid = new Map(vevents.map((v) => [new ICAL.Event(v).uid, new ICAL.Event(v)]));
    const a = byUid.get(events.find((e) => e.externalId === 'assignment:555')!.uid)!;
    expect(a.summary).toBe('CMPT 225: Assignment 2: Linked Lists');
    expect(a.startDate.toJSDate().toISOString()).toBe('2026-09-20T06:29:00.000Z');
    expect(a.endDate.toJSDate().toISOString()).toBe('2026-09-20T06:59:00.000Z');
    const q = byUid.get(events.find((e) => e.externalId === 'quiz:777')!.uid)!;
    expect(q.summary).toBe('✓ CMPT 225: Quiz 1');
  });

  it('uses CRLF and folds long lines', () => {
    expect(ics.includes('\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toContain('X-WR-CALNAME:Canvas (SFU)');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT30M');
  });

  it('escapes and folds correctly', () => {
    expect(escapeText('a,b;c\nd\\e')).toBe('a\\,b\;c\\nd\\\\e');
    const folded = foldLine('X:' + 'é'.repeat(100));
    for (const line of folded.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe('X:' + 'é'.repeat(100));
  });
});
