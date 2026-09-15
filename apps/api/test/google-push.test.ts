import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import type { NormalizedEvent } from '@cally/core';

const USER = 'test_gpush_user';

// Imports are deferred so setup.ts can populate the env first.
const { db, schema, sql } = await import('../src/db/client.js');
const { encrypt } = await import('../src/crypto.js');
const { applySnapshot } = await import('../src/sync/snapshot.js');
const { pushGoogleForUser, syncUser } = await import('../src/sync/engine.js');

interface Call { method: string; url: string; body?: any }
let calls: Call[] = [];
let calendarExists = true;

/** Fake Google: token endpoint, calendar create/get, event insert (409 for known ids), put, delete. */
const known = new Set<string>();
function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const isJson = init?.body && !(init.body instanceof URLSearchParams);
  const body = isJson ? JSON.parse(String(init!.body)) : undefined;
  calls.push({ method, url, body });
  const json = (status: number, data: unknown) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status }));

  if (url.startsWith('https://oauth2.googleapis.com/token')) return json(200, { access_token: 'at', expires_in: 3600 });
  if (url.endsWith('/calendars') && method === 'POST') { calendarExists = true; return json(200, { id: 'cal123@group.calendar.google.com' }); }
  if (/\/calendars\/[^/]+$/.test(url) && method === 'GET') return calendarExists ? json(200, { id: 'cal123' }) : json(404, { error: 'gone' });
  if (/\/events$/.test(url) && method === 'POST') {
    if (known.has(body.id)) return json(409, { error: 'exists' });
    known.add(body.id);
    return json(200, body);
  }
  if (/\/events\/[a-v0-9]+$/.test(url) && method === 'PUT') return json(200, body);
  if (/\/events\/[a-v0-9]+$/.test(url) && method === 'DELETE') { known.delete(url.split('/').pop()!); return json(204, null); }
  return json(500, { error: `unhandled ${method} ${url}` });
}

const ev = (id: string, title: string, start: string): NormalizedEvent => ({
  uid: `cally-${id}@cally`, source: 'canvas', externalId: `assignment:${id}`, kind: 'assignment', title,
  start, end: new Date(new Date(start).getTime() + 30 * 60_000).toISOString(), allDay: false, completed: false,
});
const window = { start: '2026-09-01T00:00:00.000Z', end: '2027-03-01T00:00:00.000Z' };

beforeAll(async () => {
  vi.stubGlobal('fetch', fakeFetch);
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await db.insert(schema.users).values({ id: USER, email: 't@sfu.ca', googleSub: 'sub_gpush', feedToken: 'ft_gpush', timezone: 'America/Vancouver' });
  await db.insert(schema.googleConnections).values({ userId: USER, refreshTokenEnc: encrypt('refresh'), scopes: 'calendar.app.created' });
});
afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, USER));
  await sql.end();
  vi.unstubAllGlobals();
});
beforeEach(() => { calls = []; });

const sinkRows = () => db.select().from(schema.sinkState).where(eq(schema.sinkState.userId, USER));
const writes = () => calls.filter((c) => /\/events/.test(c.url)).map((c) => `${c.method} ${c.body?.summary ?? c.url.split('/').pop()}`);

describe('pushGoogleForUser', () => {
  it('creates the calendar and inserts every live event on first run', async () => {
    await applySnapshot(USER, [ev('a1', 'A1', '2026-10-01T06:59:00.000Z'), ev('a2', 'A2', '2026-10-02T06:59:00.000Z')], window);
    await pushGoogleForUser(USER);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/calendars'))).toBe(true);
    expect(writes()).toEqual(['POST A1', 'POST A2']);
    const [conn] = await db.select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, USER));
    expect(conn!.calendarId).toBe('cal123@group.calendar.google.com');
    expect(conn!.lastError).toBeNull();
    expect((await sinkRows()).length).toBe(2);
  });

  it('is a no-op when nothing changed', async () => {
    await pushGoogleForUser(USER);
    expect(writes()).toEqual([]);
  });

  it('pushes only the changed event, and deletes tombstones', async () => {
    // A1 retitled, A2 gone upstream, A3 new.
    await applySnapshot(USER, [ev('a1', 'A1 (moved)', '2026-10-03T06:59:00.000Z'), ev('a3', 'A3', '2026-10-05T06:59:00.000Z')], window);
    await pushGoogleForUser(USER);
    // A1's id is known to fake Google -> 409 -> PUT. A3 is new -> POST. A2 -> DELETE.
    expect(writes().sort()).toEqual(['DELETE ' + calls.find((c) => c.method === 'DELETE')!.url.split('/').pop(), 'POST A1 (moved)', 'POST A3', 'PUT A1 (moved)'].sort());
    const rows = await sinkRows();
    expect(rows.map((r) => r.uid).sort()).toEqual(['cally-a1@cally', 'cally-a3@cally']);
    const [run] = await db.select().from(schema.syncRuns).where(eq(schema.syncRuns.userId, USER)).orderBy(desc(schema.syncRuns.startedAt));
    expect(run!.ok).toBe(true);
    expect(run!.detail).toEqual({ created: 1, updated: 1, removed: 1, errors: 0 });
  });

  it('purges tombstones only after the sink has processed them', async () => {
    const before = await db.select().from(schema.events).where(eq(schema.events.userId, USER));
    expect(before.filter((r) => r.deletedAt).length).toBe(1); // a2 still tombstoned: purge runs in syncUser
    await syncUser(USER);
    const after = await db.select().from(schema.events).where(eq(schema.events.userId, USER));
    expect(after.filter((r) => r.deletedAt).length).toBe(0);
    expect(after.length).toBe(2);
  });

  it('does not touch Google at all when there is nothing to push', async () => {
    await pushGoogleForUser(USER);
    expect(calls).toEqual([]);
  });

  it('recreates the calendar and re-pushes everything if the user deleted it', async () => {
    calendarExists = false;
    known.clear();
    // Deletion is only noticed when there's something to push.
    await applySnapshot(USER, [ev('a1', 'A1 (moved)', '2026-10-03T06:59:00.000Z'), ev('a3', 'A3 (edited)', '2026-10-05T06:59:00.000Z')], window);
    await pushGoogleForUser(USER);
    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/calendars')).length).toBe(1);
    expect(writes().sort()).toEqual(['POST A1 (moved)', 'POST A3 (edited)']);
    expect((await sinkRows()).length).toBe(2);
  });

  it('records a revoked-token error without throwing', async () => {
    const realFake = fakeFetch;
    vi.stubGlobal('fetch', (input: any, init?: RequestInit) => {
      if (String(input).startsWith('https://oauth2.googleapis.com/token')) return Promise.resolve(new Response('{"error":"invalid_grant"}', { status: 400 }));
      return realFake(input, init);
    });
    await applySnapshot(USER, [ev('a1', 'A1 (again)', '2026-10-03T06:59:00.000Z'), ev('a3', 'A3 (edited)', '2026-10-05T06:59:00.000Z')], window);
    await pushGoogleForUser(USER);
    const [conn] = await db.select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, USER));
    expect(conn!.lastError).toMatch(/revoked/i);
    vi.stubGlobal('fetch', realFake);
  });
});
