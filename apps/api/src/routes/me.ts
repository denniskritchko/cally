import { Hono } from 'hono';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { env, googleEnabled } from '../env.js';
import { requireUser } from '../auth/session.js';
import { randomToken } from '../crypto.js';
import { rowToEvent } from '../sync/snapshot.js';
import { enqueueUserSync } from '../sync/jobs.js';

export const meRoutes = new Hono();
meRoutes.use('*', requireUser);

export function feedUrl(feedToken: string): { https: string; webcal: string } {
  const https = `${env.APP_URL}/f/${feedToken}.ics`;
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}

meRoutes.get('/', async (c) => {
  const user = c.get('user');
  const [canvas, google, devices, runs, upcoming, eventCount] = await Promise.all([
    db.select().from(schema.canvasConnections).where(eq(schema.canvasConnections.userId, user.id)).then((r) => r[0] ?? null),
    db.select().from(schema.googleConnections).where(eq(schema.googleConnections.userId, user.id)).then((r) => r[0] ?? null),
    db.select().from(schema.extensionDevices).where(eq(schema.extensionDevices.userId, user.id)),
    db.select().from(schema.syncRuns).where(eq(schema.syncRuns.userId, user.id)).orderBy(desc(schema.syncRuns.startedAt)).limit(10),
    db
      .select()
      .from(schema.events)
      .where(and(eq(schema.events.userId, user.id), isNull(schema.events.deletedAt), gte(schema.events.startAt, new Date(Date.now() - 3_600_000))))
      .orderBy(schema.events.startAt)
      .limit(15),
    db.$count(schema.events, and(eq(schema.events.userId, user.id), isNull(schema.events.deletedAt))),
  ]);

  return c.json({
    user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone },
    feed: feedUrl(user.feedToken),
    canvas: canvas && {
      kind: canvas.kind,
      baseUrl: canvas.baseUrl,
      canvasUserName: canvas.canvasUserName,
      lastSyncedAt: canvas.lastSyncedAt,
      lastError: canvas.lastError,
    },
    google: {
      enabled: googleEnabled,
      connected: !!google,
      calendarId: google?.calendarId ?? null,
      lastSyncedAt: google?.lastSyncedAt ?? null,
      lastError: google?.lastError ?? null,
    },
    extension: {
      devices: devices.map((d) => ({ id: d.id, label: d.label, lastSeenAt: d.lastSeenAt, lastPushAt: d.lastPushAt, lastPushCount: d.lastPushCount })),
    },
    eventCount,
    upcoming: upcoming.map(rowToEvent),
    recentRuns: runs.map((r) => ({ stage: r.stage, ok: r.ok, detail: r.detail, startedAt: r.startedAt, finishedAt: r.finishedAt })),
    canvasBaseUrl: env.CANVAS_BASE_URL,
  });
});

meRoutes.post('/sync', async (c) => {
  await enqueueUserSync(c.get('user').id);
  return c.json({ ok: true });
});

/** New feed URL; the old one stops working immediately. */
meRoutes.post('/feed/rotate', async (c) => {
  const feedToken = randomToken(24);
  await db.update(schema.users).set({ feedToken }).where(eq(schema.users.id, c.get('user').id));
  return c.json({ feed: feedUrl(feedToken) });
});

meRoutes.delete('/google', async (c) => {
  const userId = c.get('user').id;
  // We leave the Google calendar itself in place; the user can delete it in Google. Forget our state.
  await db.delete(schema.googleConnections).where(eq(schema.googleConnections.userId, userId));
  await db.delete(schema.sinkState).where(and(eq(schema.sinkState.userId, userId), eq(schema.sinkState.sink, 'google')));
  return c.json({ ok: true });
});

meRoutes.delete('/account', async (c) => {
  await db.delete(schema.users).where(eq(schema.users.id, c.get('user').id));
  return c.json({ ok: true });
});
