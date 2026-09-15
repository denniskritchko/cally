import { describe, expect, it } from 'vitest';
import { normalizePlannerItems, shortCourseName, parseNextLink, CanvasClient, sessionFetch } from '../src/canvas/index.js';
import { eventUid } from '../src/uid.js';
import { plannerItems } from './fixtures.js';

const opts = { host: 'canvas.sfu.ca', absoluteUrl: (p: string | null | undefined) => (p ? `https://canvas.sfu.ca${p}` : undefined) };

describe('normalizePlannerItems', () => {
  const events = normalizePlannerItems(plannerItems, opts);

  it('drops announcements and keeps everything else', () => {
    expect(events.map((e) => e.externalId).sort()).toEqual(
      ['assignment:555', 'calendar_event:42', 'planner_note:3', 'quiz:777'].sort(),
    );
  });

  it('renders due dates as a 30-minute block ending at the due time', () => {
    const a = events.find((e) => e.externalId === 'assignment:555')!;
    expect(a.start).toBe('2026-09-20T06:29:00.000Z');
    expect(a.end).toBe('2026-09-20T06:59:00.000Z');
    expect(a.allDay).toBe(false);
    expect(a.title).toBe('CMPT 225: Assignment 2: Linked Lists');
    expect(a.url).toBe('https://canvas.sfu.ca/courses/91234/assignments/555');
    expect(a.description).toContain('100 pts');
    expect(a.completed).toBe(false);
  });

  it('keeps real start/end for calendar events', () => {
    const m = events.find((e) => e.externalId === 'calendar_event:42')!;
    expect(m.start).toBe('2026-10-01T17:30:00.000Z');
    expect(m.end).toBe('2026-10-01T19:20:00.000Z');
    expect(m.kind).toBe('event');
    expect(m.description).toContain('AQ 3150');
  });

  it('marks submitted and manually-completed items', () => {
    expect(events.find((e) => e.externalId === 'quiz:777')!.completed).toBe(true);
    const note = events.find((e) => e.externalId === 'planner_note:3')!;
    expect(note.completed).toBe(true);
    expect(note.description).toContain('Level 3 & 4');
    expect(note.courseName).toBeUndefined();
  });

  it('produces stable UIDs', () => {
    const a = events.find((e) => e.externalId === 'assignment:555')!;
    expect(a.uid).toBe(eventUid('canvas', 'assignment:555', 'canvas.sfu.ca'));
    expect(a.uid).toMatch(/^cally-[0-9a-f]{16}@cally$/);
  });
});

describe('shortCourseName', () => {
  it('strips the section suffix', () => {
    expect(shortCourseName('CMPT 225 D100')).toBe('CMPT 225');
    expect(shortCourseName('MATH 232 D200')).toBe('MATH 232');
    expect(shortCourseName('IAT 100W E100')).toBe('IAT 100W');
    expect(shortCourseName('Some Weird Course')).toBe('Some Weird Course');
  });
});

describe('CanvasClient', () => {
  it('parses Link headers', () => {
    expect(parseNextLink('<https://x/api?page=2>; rel="next", <https://x/api?page=1>; rel="first"')).toBe('https://x/api?page=2');
    expect(parseNextLink('<https://x/api?page=1>; rel="first"')).toBeUndefined();
  });

  it('strips the while(1); prefix and follows pagination', async () => {
    const calls: string[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect(init?.credentials).toBe('include');
      const page = new URL(url).searchParams.get('page') ?? '1';
      const headers = new Headers();
      if (page === '1') headers.set('link', `<${url}&page=2>; rel="next"`);
      return new Response(`while(1);[{"n":${page}}]`, { status: 200, headers });
    };
    const client = new CanvasClient({ baseUrl: 'https://canvas.sfu.ca/', fetch: sessionFetch(fake as any) });
    const items = await client.getAll<{ n: number }>('/planner/items', { start_date: '2026-01-01' });
    expect(items).toEqual([{ n: 1 }, { n: 2 }]);
    expect(calls[0]).toContain('/api/v1/planner/items?start_date=2026-01-01&per_page=100');
    expect(client.host).toBe('canvas.sfu.ca');
    expect(client.absoluteUrl('/courses/1')).toBe('https://canvas.sfu.ca/courses/1');
  });
});
